#!/usr/bin/env npx tsx
/**
 * validate-agent-instructions.ts
 * Validates that agent instruction XML is well-formed and contains required elements.
 *
 * Usage:
 *   npx tsx scripts/validate-agent-instructions.ts <file.xml>
 *   cat instructions.xml | npx tsx scripts/validate-agent-instructions.ts
 *   echo '<agent-instructions>...</agent-instructions>' | npx tsx scripts/validate-agent-instructions.ts --stdin
 *
 * Exit code: 0 if valid, 1 if invalid.
 */

import * as fs from 'fs';
import * as path from 'path';

const REQUIRED_ROOT = 'agent-instructions';

interface ValidationError {
  message: string;
  line?: number;
}

function parseXML(content: string): { doc: Document; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  // Check balanced tags using regex (lightweight pre-check)
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];

    // Self-closing tags: skip
    if (fullTag.endsWith('/>')) continue;
    // Comments: skip
    if (fullTag.startsWith('<!--')) continue;

    if (fullTag.startsWith('</')) {
      // Closing tag
      if (stack.length === 0) {
        errors.push({ message: `Unexpected closing tag </${tagName}> with no matching open tag` });
      } else if (stack[stack.length - 1] !== tagName) {
        errors.push({ message: `Mismatched closing tag </${tagName}>, expected </${stack[stack.length - 1]}>` });
      } else {
        stack.pop();
      }
    } else {
      // Opening tag
      stack.push(tagName);
    }
  }

  if (stack.length > 0) {
    errors.push({ message: `Unclosed tag(s): ${stack.join(', ')}` });
  }

  // Now try real XML parsing using the built-in parser (Node.js has this)
  // Wrap in a try block since Node.js XML parsing requires the --experimental-xml flag
  try {
    // Simple regex-based structural validation as fallback
    const rootMatch = content.match(/<([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>/);
    if (!rootMatch) {
      errors.push({ message: 'No XML root element found' });
    } else if (rootMatch[1] !== REQUIRED_ROOT) {
      errors.push({ message: `Root element must be <${REQUIRED_ROOT}>, found <${rootMatch[1]}>` });
    }
  } catch {
    errors.push({ message: 'XML parsing failed' });
  }

  // We can't return a real Document without a parser, but we'll use the errors
  const doc = {} as Document;
  return { doc, errors };
}

function validateStructure(content: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required child elements of <agent-instructions>
  const requiredChildren = ['meta', 'context', 'tasks', 'constraints'];
  for (const child of requiredChildren) {
    const openTag = new RegExp(`<${child}[>\\s]`);
    const closeTag = new RegExp(`</${child}>`);
    const hasOpen = openTag.test(content);
    const hasClose = closeTag.test(content);
    if (!hasOpen || !hasClose) {
      errors.push({ message: `Missing required element: <${child}>` });
    }
  }

  // Validate <meta> required children
  const metaMatch = content.match(/<meta>([\s\S]*?)<\/meta>/);
  if (metaMatch) {
    const metaContent = metaMatch[1];
    const metaRequired = ['spec', 'scope'];
    for (const field of metaRequired) {
      if (!new RegExp(`<${field}>`).test(metaContent)) {
        errors.push({ message: `Missing required field in <meta>: <${field}>` });
      }
    }
  }

  // Validate <tasks> has at least one <task>
  const tasksMatch = content.match(/<tasks>([\s\S]*?)<\/tasks>/);
  if (tasksMatch) {
    const taskCount = (tasksMatch[1].match(/<task\b/g) || []).length;
    if (taskCount === 0) {
      errors.push({ message: '<tasks> must contain at least one <task>' });
    }
  }

  // Validate <constraints> has at least one <constraint>
  const constraintsMatch = content.match(/<constraints>([\s\S]*?)<\/constraints>/);
  if (constraintsMatch) {
    const constraintCount = (constraintsMatch[1].match(/<constraint>/g) || []).length;
    if (constraintCount === 0) {
      errors.push({ message: '<constraints> must contain at least one <constraint>' });
    }
  }

  return errors;
}

function main(): void {
  let content: string;

  // Read from file or stdin
  const args = process.argv.slice(2);
  const isStdin = args.includes('--stdin');

  if (isStdin || args.length === 0) {
    // Read from stdin
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => {
      content = Buffer.concat(chunks).toString('utf-8');
      runValidation(content);
    });
    process.stdin.resume();
    return;
  }

  const filePath = args[0];
  if (!fs.existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`);
    process.exit(1);
  }

  content = fs.readFileSync(filePath, 'utf-8');
  runValidation(content);
}

function runValidation(content: string): void {
  const allErrors: ValidationError[] = [];

  // Step 1: XML well-formedness
  const { errors: parseErrors } = parseXML(content);
  allErrors.push(...parseErrors);

  // Step 2: Structure validation
  const structureErrors = validateStructure(content);
  allErrors.push(...structureErrors);

  // Step 3: Check for empty content (all tags must have content)
  const emptyTagPattern = /<(spec|scope|description|task|constraint|file)>[\s]*<\/\1>/g;
  let emptyMatch: RegExpExecArray | null;
  while ((emptyMatch = emptyTagPattern.exec(content)) !== null) {
    allErrors.push({ message: `Empty tag: <${emptyMatch[1]}> must contain content` });
  }

  if (allErrors.length === 0) {
    console.log('✓ Agent instructions XML is valid');
    process.exit(0);
  } else {
    console.error('✗ Agent instructions XML validation failed:');
    for (const err of allErrors) {
      console.error(`  - ${err.message}`);
    }
    console.error(`\n  Total errors: ${allErrors.length}`);
    console.error('\n  Required format:');
    console.error('  <agent-instructions>');
    console.error('    <meta>');
    console.error('      <spec>spec/YYYY-MM-DD-slug.spec.md</spec>');
    console.error('      <scope>feature-slug</scope>');
    console.error('    </meta>');
    console.error('    <context>');
    console.error('      <description>Brief description</description>');
    console.error('    </context>');
    console.error('    <tasks>');
    console.error('      <task id="UST-01">Task description</task>');
    console.error('    </tasks>');
    console.error('    <constraints>');
    console.error('      <constraint>Follow hexagonal architecture</constraint>');
    console.error('    </constraints>');
    console.error('  </agent-instructions>');
    process.exit(1);
  }
}

main();
