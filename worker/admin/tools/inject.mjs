import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('dist', 'index.html');
const workerPath = path.resolve('..', 'src', 'index.ts');

if (!fs.existsSync(htmlPath)) {
    console.error('Build output not found! Run build first.');
    process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

// Escape backticks in HTML for template literal
const escapedHtml = html.replace(/`/g, '\\`').replace(/\$/g, '\\$');

let workerContent = fs.readFileSync(workerPath, 'utf8');

// Look for handleAdminDashboard and replace the html template literal
const startMarker = 'function handleAdminDashboard(): Response {';
const endMarker = '    return new Response(html, {';

const startIndex = workerContent.indexOf(startMarker);
const endIndex = workerContent.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find injection point in worker/src/index.ts');
    process.exit(1);
}

const newFunction = `function handleAdminDashboard(): Response {
    const html = \`${escapedHtml}\`;
`;

const updatedContent = workerContent.slice(0, startIndex) + newFunction + workerContent.slice(endIndex);

fs.writeFileSync(workerPath, updatedContent);
console.log('Successfully injected Admin UI into worker/src/index.ts');
