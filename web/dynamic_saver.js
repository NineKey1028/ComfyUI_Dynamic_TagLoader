import { app } from "../../scripts/app.js";
import { getDynamicGroupMenu, setupSizeManager } from "./dynamic_utils.js";

app.registerExtension({
    name: "ComfyUI.DynamicTagSaver",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "DynamicTagSaver") {

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                setupSizeManager(node);

                const settingsWidget = node.widgets.find(w => w.name === "lora_settings");
                if (settingsWidget) {
                    settingsWidget.type = "hidden";
                    settingsWidget.computeSize = () => [0, -4];
                }

                const filenameIdx = node.widgets.findIndex(w => w.name === "filename");
                if (filenameIdx !== -1) {
                    const separatorWidget = {
                        name: "separator",
                        type: "display",
                        computeSize: () => [0, 30],
                        draw: function(ctx, node, widget_width, y, widget_height) {
                            ctx.fillStyle = "#888"; 
                            ctx.font = "10px Arial";
                            ctx.textAlign = "center";
                            ctx.fillText("▼ LoRA Auto Merge ▼", widget_width * 0.5, y + 18);
                            
                            ctx.strokeStyle = "#444"; 
                            ctx.beginPath();
                            ctx.moveTo(10, y + 24);
                            ctx.lineTo(widget_width - 10, y + 24);
                            ctx.stroke();
                            
                            ctx.textAlign = "left";
                        }
                    };
                    node.widgets.splice(filenameIdx + 1, 0, separatorWidget);
                }

                node.loraList = [];       
                node.dynamicWidgets = []; 
                node.addLoraButton = null; 

                // -----------------------------------------------------------
                // Helper: 重建 Widget 列表
                // -----------------------------------------------------------
                const rebuildWidgetList = () => {
                    const staticWidgets = node.widgets.filter(w => 
                        w !== node.addLoraButton && 
                        !node.dynamicWidgets.some(g => g.loraSelector === w || g.strengthInput === w)
                    );
                    
                    node.widgets = [...staticWidgets];
                    
                    node.dynamicWidgets.forEach(g => {
                        node.widgets.push(g.loraSelector);
                        node.widgets.push(g.strengthInput);
                    });
                    
                    if (node.addLoraButton) node.widgets.push(node.addLoraButton);
                };

                const updateSettings = () => {
                    const data = {};
                    for (let i = 0; i < node.dynamicWidgets.length; i++) {
                        const group = node.dynamicWidgets[i];
                        data[i] = {
                            lora_name: group.loraSelector.value,
                            strength: group.strengthInput.value
                        };
                    }
                    if (settingsWidget) {
                        settingsWidget.value = JSON.stringify(data);
                    }
                };

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
                    if (node.loraList.length === 0) return alert("No LoRAs found!");

                    createSearchableMenu(window.event, node.loraList, (selectedLora) => {
                        if (selectedLora) {
                            const targetIndex = position === "before" ? index : index + 1;
                            node.performAdd(() => {
                                node.addLoraInputs(selectedLora, 1.0, targetIndex);
                            });
                        }
                    });
                };

                const removeGroup = (index) => {
                    node.performRemove(() => {
                        const group = node.dynamicWidgets[index];
                        
                        const lIdx = node.widgets.indexOf(group.loraSelector);
                        if (lIdx > -1) node.widgets.splice(lIdx, 1);
                        const sIdx = node.widgets.indexOf(group.strengthInput);
                        if (sIdx > -1) node.widgets.splice(sIdx, 1);

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
                        const groupIndex = node.dynamicWidgets.findIndex(g => g.loraSelector === foundWidget || g.strengthInput === foundWidget);
                        if (groupIndex !== -1) {
                            return { widget: foundWidget, output: { type: "LORA_GROUP", groupIndex: groupIndex } };
                        }
                    }
                    return null;
                };

                const originalGetSlotMenuOptions = node.getSlotMenuOptions;
                node.getSlotMenuOptions = function(slot) {
                    if (slot && slot.output && slot.output.type === "LORA_GROUP") {
                        const index = slot.output.groupIndex;
                        const menuItems = getDynamicGroupMenu(
                            index, 
                            node.dynamicWidgets.length, 
                            moveGroup,
                            moveGroupAbsolute,
                            handleInsert,
                            removeGroup
                        );
                        new LiteGraph.ContextMenu(menuItems, {
                            title: "LoRA Options",
                            event: app.canvas.last_mouse_event || window.event 
                        });
                        return null;
                    }
                    return originalGetSlotMenuOptions ? originalGetSlotMenuOptions.apply(this, arguments) : null;
                };

                // -----------------------------------------------------------
                // 動態組件生成
                // -----------------------------------------------------------
                this.addLoraInputs = function (defaultLora = null, defaultStrength = 1.0, insertIndex = null) {
                    if (node.addLoraButton) {
                        const idx = node.widgets.indexOf(node.addLoraButton);
                        if (idx !== -1) node.widgets.splice(idx, 1);
                    }

                    const initialLora = defaultLora || (node.loraList.length > 0 ? node.loraList[0] : "None");

                    const loraSelector = node.addWidget(
                        "combo",
                        "LoRA Name",
                        initialLora,
                        () => updateSettings(),
                        { values: node.loraList }
                    );

                    const strengthInput = node.addWidget(
                        "number",
                        "Strength",
                        defaultStrength,
                        () => updateSettings(),
                        { min: -10.0, max: 10.0, step: 0.1, precision: 2 }
                    );
                    
                    strengthInput.computeSize = () => [0, 30];

                    const newGroup = {
                        loraSelector: loraSelector,
                        strengthInput: strengthInput
                    };

                    if (insertIndex !== null && insertIndex >= 0 && insertIndex <= node.dynamicWidgets.length) {
                        node.dynamicWidgets.splice(insertIndex, 0, newGroup);
                    } else {
                        node.dynamicWidgets.push(newGroup);
                    }

                    updateSettings();
                    rebuildWidgetList();
                };

                // -----------------------------------------------------------
                // 輔助功能
                // -----------------------------------------------------------
                const createSearchableMenu = (event, values, callback) => {
                    const menu = new LiteGraph.ContextMenu(values, {
                        event: event,
                        callback: callback,
                        scale: 1.3 
                    });

                    const searchInput = document.createElement("input");
                    searchInput.placeholder = "🔍 Search LoRA...";
                    searchInput.style.cssText = `
                        width: 95%; 
                        margin: 5px auto; 
                        display: block; 
                        box-sizing: border-box; 
                        background: #222; 
                        color: #fff; 
                        border: 1px solid #555; 
                        padding: 4px;
                        border-radius: 4px;
                    `;

                    searchInput.addEventListener("input", (e) => {
                        const term = e.target.value.toLowerCase();
                        const entries = menu.root.querySelectorAll(".litemenu-entry");
                        entries.forEach(entry => {
                            const text = entry.innerText.toLowerCase();
                            if (!text) return;
                            if (text.includes(term)) {
                                entry.style.display = "block";
                            } else {
                                entry.style.display = "none";
                            }
                        });
                    });

                    searchInput.addEventListener("mouseup", (e) => e.stopPropagation());
                    searchInput.addEventListener("keydown", (e) => e.stopPropagation());

                    menu.root.prepend(searchInput);
                    setTimeout(() => searchInput.focus(), 10);
                };

                // -----------------------------------------------------------
                // 啟動與載入
                // -----------------------------------------------------------
                node.addLoraButton = this.addWidget(
                    "button",
                    "+ Add LoRA",
                    null,
                    function (value, canvas, node, pos, event) {
                        if (node.loraList.length === 0) {
                            alert("No LoRAs found or list not loaded yet.");
                            return;
                        }
                        createSearchableMenu(
                            event, 
                            node.loraList, 
                            (selectedLora) => {
                                if(selectedLora) {
                                    node.performAdd(() => {
                                        node.addLoraInputs(selectedLora, 1.0);
                                    });
                                }
                            }
                        );
                    }
                );

                fetch("/custom_nodes/loras_list")
                    .then(response => response.json())
                    .then(data => {
                        node.loraList = ["None", ...data];
                        
                        if (settingsWidget && settingsWidget.value && settingsWidget.value !== "{}") {
                            try {
                                const savedData = JSON.parse(settingsWidget.value);
                                Object.keys(savedData)
                                    .sort((a, b) => parseInt(a) - parseInt(b))
                                    .forEach(key => {
                                        const item = savedData[key];
                                        this.addLoraInputs(item.lora_name, item.strength);
                                    });
                                
                                requestAnimationFrame(() => {
                                    node.triggerAutoSize();
                                });
                            } catch (e) {
                                console.error("Error restoring loras:", e);
                            }
                        }
                    });

                return r;
            };
        }
    }
});