import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI.DynamicTagLoader",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "DynamicTagLoaderJS") {

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                // -----------------------------------------------------------
                // 1. 核心狀態與隱藏組件初始化
                // -----------------------------------------------------------
                node.expectedSize = null; // 儲存從工作流 (Workflow) 讀取的原始尺寸，防止非同步載入後塌陷
                
                // 查找並隱藏用於儲存 JSON 狀態的 widget，使其不顯示於 UI 上
                const settingsWidget = node.widgets.find(w => w.name === "tag_settings");
                if (settingsWidget) {
                    settingsWidget.type = "hidden";
                    settingsWidget.computeSize = () => [0, -4]; 
                }

                node.tagsData = {};        // 儲存從伺服器獲取的標籤結構數據
                node.dynamicWidgets = [];  // 管理動態產生的組件群組 (Folder + File)
                node.addTagButton = null;  // 新增按鈕實例暫存

                // -----------------------------------------------------------
                // 2. 生命週期攔截：序列化配置載入 (onConfigure)
                // -----------------------------------------------------------
                const onConfigure = node.onConfigure;
                node.onConfigure = function(data) {
                    if (onConfigure) onConfigure.apply(this, arguments);
                    if (data && data.size) {
                        // 擷取工作流定義中的尺寸，用於後續內容非同步填充後的尺寸修正基準
                        node.expectedSize = [...data.size];
                    }
                };

                // -----------------------------------------------------------
                // 3. UI 尺寸自適應校準邏輯
                // -----------------------------------------------------------
                node.fixSize = function() {
                    const computeSize = node.computeSize();
                    let targetHeight = computeSize[1];

                    // 比較「內容所需高度」與「工作流記錄高度」，取較大值以確保 UI 完整性
                    if (node.expectedSize && node.expectedSize[1] > targetHeight) {
                        targetHeight = node.expectedSize[1];
                    }

                    node.size[1] = targetHeight;
                    node.setDirtyCanvas(true, true); // 請求畫布重繪
                };

                /**
                 * 狀態序列化：將當前動態組件的數值同步至隱藏的 settingsWidget 中
                 */
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

                /**
                 * 下拉選單連動：根據選擇的資料夾更新對應的檔案列表
                 */
                function updateFileWidget(folderName, fileWidget) {
                    if (node.tagsData[folderName]) {
                        fileWidget.options.values = node.tagsData[folderName];
                        if (!node.tagsData[folderName].includes(fileWidget.value)) {
                            fileWidget.value = "ALL"; // 若目前值不在新清單中，重置為預設值
                        }
                    } else {
                        fileWidget.options.values = [];
                    }
                }

                /**
                 * 組件排序管理：移動指定的動態組件群組位置
                 */
                const moveGroup = (index, direction) => {
                    const newIndex = index + direction;
                    if (newIndex < 0 || newIndex >= node.dynamicWidgets.length) return;
                    
                    const temp = node.dynamicWidgets[index];
                    node.dynamicWidgets[index] = node.dynamicWidgets[newIndex];
                    node.dynamicWidgets[newIndex] = temp;

                    // 重新構建 widgets 陣列以反映 UI 排序
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
                    updateSettings();
                    node.setDirtyCanvas(true, true);
                };

                /**
                 * 組件移除邏輯：銷毀組件實例並重新計算節點尺寸
                 */
                const removeGroup = (index) => {
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
                    node.setSize([node.size[0], node.computeSize()[1]]);
                    node.setDirtyCanvas(true, true);
                };

                // -----------------------------------------------------------
                // 4. 交互事件攔截：精準組件定位與自定義右鍵選單
                // -----------------------------------------------------------
                const originalGetSlotInPosition = node.getSlotInPosition;
                node.getSlotInPosition = function(canvasX, canvasY) {
                    const slot = originalGetSlotInPosition ? originalGetSlotInPosition.apply(this, arguments) : null;
                    if (slot) return slot; 

                    // 遍歷所有組件，判斷滑鼠點擊位置是否落於動態組件範圍內
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
                            // 返回虛擬 Slot 以觸發自定義 Context Menu
                            return { widget: foundWidget, output: { type: "TAG_GROUP", groupIndex: groupIndex } };
                        }
                    }
                    return null;
                };

                const originalGetSlotMenuOptions = node.getSlotMenuOptions;
                node.getSlotMenuOptions = function(slot) {
                    // 若命中動態組件，顯示自定義的操作選單（上移、下移、刪除）
                    if (slot && slot.output && slot.output.type === "TAG_GROUP") {
                        const index = slot.output.groupIndex;
                        const menuItems = [
                            { content: "⬆️ Move Up", disabled: index === 0, callback: () => moveGroup(index, -1) },
                            { content: "⬇️ Move Down", disabled: index === node.dynamicWidgets.length - 1, callback: () => moveGroup(index, 1) },
                            null,
                            { content: "🗑️ Remove", callback: () => removeGroup(index) }
                        ];
                        new LiteGraph.ContextMenu(menuItems, { title: "Tag Group Options", event: app.canvas.last_mouse_event || window.event });
                        return null;
                    }
                    return originalGetSlotMenuOptions ? originalGetSlotMenuOptions.apply(this, arguments) : null;
                };

                // -----------------------------------------------------------
                // 5. 動態組件生成功能 (Factory Method)
                // -----------------------------------------------------------
                this.addTagInputs = function (defaultFolder = null, defaultFile = null) {
                    // 確保新增按鈕始終位於組件列表的最末端
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

                    node.dynamicWidgets.push({ type: "file", folder: folderWidget, file: fileWidget });
                    if (defaultFile && fileWidget.options.values.includes(defaultFile)) {
                        fileWidget.value = defaultFile;
                    }

                    updateSettings();
                    if (node.addTagButton) node.widgets.push(node.addTagButton);
                    node.setSize([node.size[0], node.computeSize()[1]]);
                };

                /**
                 * 建立具備即時過濾功能的搜尋選單
                 */
                const createSearchableMenu = (event, values, callback) => {
                    const menu = new LiteGraph.ContextMenu(values, { event: event, callback: callback, scale: 1.3 });
                    const searchInput = document.createElement("input");
                    searchInput.placeholder = "🔍 Search Folder...";
                    searchInput.style.cssText = `width: 95%; margin: 5px auto; display: block; background: #222; color: #fff; border: 1px solid #555; padding: 4px; border-radius: 4px;`;
                    
                    // 實現清單過濾邏輯
                    searchInput.addEventListener("input", (e) => {
                        const term = e.target.value.toLowerCase();
                        menu.root.querySelectorAll(".litemenu-entry").forEach(entry => {
                            const text = entry.innerText.toLowerCase();
                            entry.style.display = (text && text.includes(term)) ? "block" : "none";
                        });
                    });
                    
                    // 阻止事件冒泡以免觸發 LiteGraph 預設行為
                    searchInput.addEventListener("mouseup", (e) => e.stopPropagation());
                    searchInput.addEventListener("keydown", (e) => e.stopPropagation());
                    menu.root.prepend(searchInput);
                    setTimeout(() => searchInput.focus(), 10);
                };

                // -----------------------------------------------------------
                // 6. 初始化載入流程與非同步數據恢復
                // -----------------------------------------------------------
                node.addTagButton = this.addWidget("button", "+ Add Tag Group", null, function (value, canvas, node, pos, event) {
                    const folderNames = Object.keys(node.tagsData).sort();
                    if (folderNames.length === 0) return alert("No tags folder found!");
                    createSearchableMenu(event, folderNames, (selectedFolder) => {
                        if (selectedFolder) node.addTagInputs(selectedFolder, "ALL");
                    });
                });

                // 從後端 API 獲取標籤結構並根據備份狀態恢復 UI
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

                                // 所有組件渲染完成後，執行雙重延遲校準以確保尺寸計算準確
                                requestAnimationFrame(() => {
                                    node.fixSize();
                                    setTimeout(() => node.fixSize(), 100);
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