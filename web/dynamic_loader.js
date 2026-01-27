import { app } from "../../scripts/app.js";
import { getDynamicGroupMenu, setupSizeManager } from "./dynamic_utils.js";

app.registerExtension({
    name: "ComfyUI.DynamicTagLoader",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "DynamicTagLoaderJS") {

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                setupSizeManager(node);

                const settingsWidget = node.widgets.find(w => w.name === "tag_settings");
                if (settingsWidget) {
                    settingsWidget.type = "hidden";
                    settingsWidget.computeSize = () => [0, -4]; 
                }

                node.tagsData = {};        
                node.dynamicWidgets = [];  
                node.addTagButton = null;  

                // -----------------------------------------------------------
                // Helper: 更新 Widget 顯示列表
                // -----------------------------------------------------------
                const rebuildWidgetList = () => {
                    const staticWidgets = node.widgets.filter(w => 
                        w !== node.addTagButton && 
                        !node.dynamicWidgets.some(g => 
                            (g.type === "text" && g.textWidget === w) || 
                            (g.type !== "text" && (g.folder === w || g.file === w))
                        )
                    );
                    
                    node.widgets = [...staticWidgets];
                    node.dynamicWidgets.forEach(g => {
                        if (g.type === "text") {
                            node.widgets.push(g.textWidget);
                        } else {
                            node.widgets.push(g.folder);
                            node.widgets.push(g.file);
                        }
                    });
                    
                    if (node.addTagButton) node.widgets.push(node.addTagButton);
                };

                const updateSettings = () => {
                    const data = {};
                    for (let i = 0; i < node.dynamicWidgets.length; i++) {
                        const group = node.dynamicWidgets[i];
                        if (group.type === "text") {
                            data[i] = { type: "text", text: group.textWidget.value };
                        } else {
                            data[i] = { type: "file", folder: group.folder.value, file: group.file.value };
                        }
                    }
                    if (settingsWidget) {
                        settingsWidget.value = JSON.stringify(data);
                    }
                };

                function updateFileWidget(folderName, fileWidget) {
                    if (node.tagsData[folderName]) {
                        fileWidget.options.values = node.tagsData[folderName];
                        if (!node.tagsData[folderName].includes(fileWidget.value)) {
                            fileWidget.value = "ALL";
                        }
                    } else {
                        fileWidget.options.values = [];
                    }
                }

                // -----------------------------------------------------------
                // 動作邏輯
                // -----------------------------------------------------------
                const moveGroup = (index, direction) => {
                    const newIndex = index + direction;
                    if (newIndex < 0 || newIndex >= node.dynamicWidgets.length) return;
                    
                    const temp = node.dynamicWidgets[index];
                    node.dynamicWidgets[index] = node.dynamicWidgets[newIndex];
                    node.dynamicWidgets[newIndex] = temp;

                    rebuildWidgetList();
                    updateSettings();
                    node.setDirtyCanvas(true, true);
                };

                const moveGroupAbsolute = (index, position) => {
                    if (position === "top" && index === 0) return;
                    if (position === "bottom" && index === node.dynamicWidgets.length - 1) return;

                    const item = node.dynamicWidgets.splice(index, 1)[0];
                    if (position === "top") {
                        node.dynamicWidgets.unshift(item);
                    } else {
                        node.dynamicWidgets.push(item);
                    }

                    rebuildWidgetList();
                    updateSettings();
                    node.setDirtyCanvas(true, true);
                };

                const handleInsert = (index, position) => {
                    const folderNames = Object.keys(node.tagsData).sort();
                    if (folderNames.length === 0) return alert("No tags folder found!");

                    createSearchableMenu(window.event, folderNames, (selectedFolder) => {
                        if (selectedFolder) {
                            const targetIndex = position === "before" ? index : index + 1;
                            node.performAdd(() => {
                                node.addTagInputs(selectedFolder, "ALL", targetIndex);
                            });
                        }
                    });
                };

                const removeGroup = (index) => {
                    node.performRemove(() => {
                        const group = node.dynamicWidgets[index];
                        if (group.type === "text") {
                            const tIdx = node.widgets.indexOf(group.textWidget);
                            if (tIdx > -1) node.widgets.splice(tIdx, 1);
                        } else {
                            const fIdx = node.widgets.indexOf(group.folder);
                            if (fIdx > -1) node.widgets.splice(fIdx, 1);
                            const lIdx = node.widgets.indexOf(group.file);
                            if (lIdx > -1) node.widgets.splice(lIdx, 1);
                        }
                        node.dynamicWidgets.splice(index, 1);
                        updateSettings();
                    });
                };

                // -----------------------------------------------------------
                // 交互與選單
                // -----------------------------------------------------------
                const originalGetSlotInPosition = node.getSlotInPosition;
                node.getSlotInPosition = function(canvasX, canvasY) {
                    const slot = originalGetSlotInPosition ? originalGetSlotInPosition.apply(this, arguments) : null;
                    if (slot) return slot; 

                    let foundWidget = null;
                    for (const widget of this.widgets) {
                        if (widget.last_y === undefined) continue; 
                        const widgetHeight = widget.computeSize ? widget.computeSize(node.size[0])[1] : 20; 
                        if (canvasY >= this.pos[1] + widget.last_y && canvasY < this.pos[1] + widget.last_y + widgetHeight) {
                            foundWidget = widget;
                            break;
                        }
                    }

                    if (foundWidget) {
                        const groupIndex = node.dynamicWidgets.findIndex(g => 
                            (g.type === "text" && g.textWidget === foundWidget) || 
                            (g.type !== "text" && (g.folder === foundWidget || g.file === foundWidget))
                        );
                        if (groupIndex !== -1) {
                            return { widget: foundWidget, output: { type: "TAG_GROUP", groupIndex: groupIndex } };
                        }
                    }
                    return null;
                };

                const originalGetSlotMenuOptions = node.getSlotMenuOptions;
                node.getSlotMenuOptions = function(slot) {
                    if (slot && slot.output && slot.output.type === "TAG_GROUP") {
                        const index = slot.output.groupIndex;
                        const menuItems = getDynamicGroupMenu(
                            index, 
                            node.dynamicWidgets.length, 
                            moveGroup,
                            moveGroupAbsolute,
                            handleInsert,
                            removeGroup
                        );
                        new LiteGraph.ContextMenu(menuItems, { title: "Tag Group Options", event: app.canvas.last_mouse_event || window.event });
                        return null;
                    }
                    return originalGetSlotMenuOptions ? originalGetSlotMenuOptions.apply(this, arguments) : null;
                };

                // -----------------------------------------------------------
                // 動態組件生成
                // -----------------------------------------------------------
                this.addTagInputs = function (defaultFolder = null, defaultFile = null, insertIndex = null) {
                    if (node.addTagButton) {
                        const idx = node.widgets.indexOf(node.addTagButton);
                        if (idx !== -1) node.widgets.splice(idx, 1);
                    }

                    const folderNames = Object.keys(node.tagsData);
                    const folderWidget = node.addWidget("combo", "Folder", defaultFolder || (folderNames.length > 0 ? folderNames[0] : ""), (v) => {
                        updateFileWidget(v, fileWidget); 
                        updateSettings(); 
                    }, { values: folderNames });

                    const fileWidget = node.addWidget("combo", "File", defaultFile || "ALL", () => updateSettings(), { values: [] });
                    fileWidget.computeSize = () => [0, 35];
                    updateFileWidget(folderWidget.value, fileWidget);

                    const newGroup = { type: "file", folder: folderWidget, file: fileWidget };

                    if (insertIndex !== null && insertIndex >= 0 && insertIndex <= node.dynamicWidgets.length) {
                        node.dynamicWidgets.splice(insertIndex, 0, newGroup);
                    } else {
                        node.dynamicWidgets.push(newGroup);
                    }

                    if (defaultFile && fileWidget.options.values.includes(defaultFile)) {
                        fileWidget.value = defaultFile;
                    }

                    rebuildWidgetList();
                    updateSettings();
                };

                const createSearchableMenu = (event, values, callback) => {
                    const menu = new LiteGraph.ContextMenu(values, { event: event, callback: callback, scale: 1.3 });
                    const searchInput = document.createElement("input");
                    searchInput.placeholder = "🔍 Search Folder...";
                    searchInput.style.cssText = `width: 95%; margin: 5px auto; display: block; background: #222; color: #fff; border: 1px solid #555; padding: 4px; border-radius: 4px;`;
                    
                    searchInput.addEventListener("input", (e) => {
                        const term = e.target.value.toLowerCase();
                        menu.root.querySelectorAll(".litemenu-entry").forEach(entry => {
                            const text = entry.innerText.toLowerCase();
                            entry.style.display = (text && text.includes(term)) ? "block" : "none";
                        });
                    });
                    
                    searchInput.addEventListener("mouseup", (e) => e.stopPropagation());
                    searchInput.addEventListener("keydown", (e) => e.stopPropagation());
                    menu.root.prepend(searchInput);
                    setTimeout(() => searchInput.focus(), 10);
                };

                // -----------------------------------------------------------
                // 初始化
                // -----------------------------------------------------------
                node.addTagButton = this.addWidget("button", "+ Add Tag Group", null, function (value, canvas, node, pos, event) {
                    const folderNames = Object.keys(node.tagsData).sort();
                    if (folderNames.length === 0) return alert("No tags folder found!");
                    createSearchableMenu(event, folderNames, (selectedFolder) => {
                        if (selectedFolder) {
                            node.performAdd(() => {
                                node.addTagInputs(selectedFolder, "ALL");
                            });
                        }
                    });
                });

                fetch("/custom_nodes/tags")
                    .then(response => response.json())
                    .then(data => {
                        node.tagsData = data;
                        if (settingsWidget && settingsWidget.value && settingsWidget.value !== "{}") {
                            try {
                                const savedData = JSON.parse(settingsWidget.value);
                                const keys = Object.keys(savedData).sort((a, b) => parseInt(a) - parseInt(b));
                                
                                keys.forEach(key => {
                                    const item = savedData[key];
                                    if (item.type === "file" && item.folder) {
                                        this.addTagInputs(item.folder, item.file);
                                    }
                                });

                                requestAnimationFrame(() => {
                                    node.triggerAutoSize();
                                });

                            } catch (e) {
                                console.error("Error restoring tags:", e);
                            }
                        }
                    });

                return r;
            };
        }
    }
});