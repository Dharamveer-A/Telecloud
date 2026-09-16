const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/Browser.tsx', 'utf8');

code = code.replace(
  /function handleInternalDragStart\(e: React\.DragEvent, item: \{ kind: "file" \| "folder"; id: string; name: string \}\) \{[\s\S]*?effectAllowed = "move";\n  \}/,
  `function handleInternalDragStart(e: React.DragEvent, item: { kind: "file" | "folder"; id: string; name: string }) {
    let itemsToMove = [item];
    if (selectedIds.has(item.id)) {
      itemsToMove = [];
      for (const id of selectedIds) {
        const fileMatch = files.find(x => x.id === id);
        if (fileMatch) itemsToMove.push({ kind: "file", id, name: fileMatch.name });
        else {
          const folderMatch = subfolders.find(x => x.id === id);
          if (folderMatch) itemsToMove.push({ kind: "folder", id, name: folderMatch.name });
        }
      }
    }
    e.dataTransfer.setData("application/telecloud-items", JSON.stringify(itemsToMove));
    e.dataTransfer.effectAllowed = "move";
  }`
);

code = code.replace(
  /const internalData = e\.dataTransfer\.getData\("application\/telecloud-item"\);\n    if \(internalData\) \{[\s\S]*?\} catch \(err: any\) \{\n        alert\(err\.message\);\n      \}\n    \}/,
  `const internalData = e.dataTransfer.getData("application/telecloud-items") || e.dataTransfer.getData("application/telecloud-item");
    if (internalData) {
      try {
        let items = JSON.parse(internalData);
        if (!Array.isArray(items)) items = [items];
        
        for (const item of items) {
          if (item.id === f.id) continue;
          if (item.kind === "file") await api.moveFile(item.id, f.id);
          else await api.moveFolder(item.id, f.id);
        }
        setSelectedIds(new Set());
        refreshCurrent();
      } catch (err: any) {
        alert(err.message);
      }
    }`
);

fs.writeFileSync('frontend/src/pages/Browser.tsx', code);
console.log("Drag logic patched");
