const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/Browser.tsx', 'utf8');

function injectGridFolder() {
  code = code.replace(
    /className=\{\`border rounded-lg px-3 py-3 flex flex-col items-start relative group cursor-pointer \$\{dropTargetId === f.id \? "bg-teal\/20 border-teal" \: "border-line bg-surface hover:border-teal"\}\`\}/g,
    `ref={(el) => registerItem(f.id, el)}
                  className={\`selectable-item border rounded-lg px-3 py-3 flex flex-col items-start relative group cursor-pointer \${dropTargetId === f.id ? "bg-teal/20 border-teal" : selectedIds.has(f.id) ? "bg-teal/20 border-teal ring-1 ring-teal" : "border-line bg-surface hover:border-teal"}\`}`
  );
  code = code.replace(
    /onClick=\{\(\) \=\> openFolder\(f\.id, f\.name, f\.locked\)\}/g,
    `onClick={(e) => { if (!handleItemClick(e, f.id)) openFolder(f.id, f.name, f.locked); }}`
  );
}

function injectListFolder() {
  code = code.replace(
    /className=\{\`flex items-center gap-3 px-4 py-3 border-b border-line cursor-pointer \$\{dropTargetId === f\.id \? "bg-teal\/20" \: "hover:bg-surface"\}\`\}/g,
    `ref={(el) => registerItem(f.id, el)}
                  className={\`selectable-item flex items-center gap-3 px-4 py-3 border-b border-line cursor-pointer \${dropTargetId === f.id ? "bg-teal/20" : selectedIds.has(f.id) ? "bg-teal/20" : "hover:bg-surface"}\`}`
  );
}

function injectGridFile() {
  code = code.replace(
    /className="border border-line rounded-lg overflow-hidden hover:border-teal bg-surface flex flex-col relative group"/g,
    `ref={(el) => registerItem(f.id, el)}
                  className={\`selectable-item border rounded-lg overflow-hidden flex flex-col relative group \${selectedIds.has(f.id) ? "bg-teal/20 border-teal ring-1 ring-teal" : "border-line bg-surface hover:border-teal"}\`}`
  );
  code = code.replace(
    /onClick=\{\(\) \=\> setPreview\(f\)\}/g,
    `onClick={(e) => { if (!handleItemClick(e, f.id)) setPreview(f); }}`
  );
}

function injectListFile() {
  code = code.replace(
    /className="flex items-center justify-between px-4 py-3 border-b border-line last:border-0 hover:bg-surface"/g,
    `ref={(el) => registerItem(f.id, el)}
                  className={\`selectable-item flex items-center justify-between px-4 py-3 border-b border-line last:border-0 \${selectedIds.has(f.id) ? "bg-teal/20" : "hover:bg-surface"}\`}`
  );
}

injectGridFolder();
injectListFolder();
injectGridFile();
injectListFile();

fs.writeFileSync('frontend/src/pages/Browser.tsx', code);
console.log("Patched");
