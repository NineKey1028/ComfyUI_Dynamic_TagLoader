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
                // 1. 初始化設定與資料結構
                // -----------------------------------------------------------
                
                // 找到後端定義的 hidden widget，將其隱藏並設為無高度
                const settingsWidget = node.widgets.find(w => w.name === "tag_settings");
                if (settingsWidget) {
                    settingsWidget.type = "hidden";
                    settingsWidget.computeSize = () => [0, -4]; 
                }

                node.tagsData = {};        // 儲存從伺服器抓取的 tags 資料結構
                node.dynamicWidgets = [];  // 儲存當前動態生成的 widget 群組
                node.addTagButton = null;  // 按鈕參照

                // -----------------------------------------------------------
                // 2. 狀態同步 (UI -> JSON)
                // -----------------------------------------------------------
                
                // 將當前所有動態 widget 的值打包成 JSON，寫入 settingsWidget 供後端讀取
                const updateSettings = () => {
                    const data = {};
                    for (let i = 0; i < node.dynamicWidgets.length; i++) {
                        const group = node.dynamicWidgets[i];
                        
                        // 目前只處理檔案類型的群組 (保留擴充性)
                        if (group.type === "text") {
                            data[i] = {
                                type: "text",
                                text: group.textWidget.value
                            };
                        } else {
                            data[i] = {
                                type: "file",
                                folder: group.folder.value,
                                file: group.file.value
                            };
                        }
                    }
                    if (settingsWidget) {
                        settingsWidget.value = JSON.stringify(data);
                    }
                };

                // -----------------------------------------------------------
                // 3. UI 連動邏輯
                // -----------------------------------------------------------
                
                // 當 Folder 改變時，更新 File 下拉選單的選項
                function updateFileWidget(folderName, fileWidget) {
                    if (node.tagsData[folderName]) {
                        fileWidget.options.values = node.tagsData[folderName];
                        // 如果當前選的值不在新清單中，重置為 "ALL"
                        if (!node.tagsData[folderName].includes(fileWidget.value)) {
                            fileWidget.value = "ALL";
                        }
                    } else {
                        fileWidget.options.values = [];
                    }
                }

                // -----------------------------------------------------------
                // 4. 群組操作功能 (移動/刪除)
                // -----------------------------------------------------------
                
                // 上移或下移指定的 Widget 群組
                const moveGroup = (index, direction) => {
                    const newIndex = index + direction;
                    // 邊界檢查
                    if (newIndex < 0 || newIndex >= node.dynamicWidgets.length) return;

                    // 交換陣列中的位置
                    const temp = node.dynamicWidgets[index];
                    node.dynamicWidgets[index] = node.dynamicWidgets[newIndex];
                    node.dynamicWidgets[newIndex] = temp;

                    // 重建 Widgets 陣列順序 (這是 ComfyUI 刷新 UI 順序的必要手段)
                    // 1. 保留靜態 widget (非動態生成的)
                    const staticWidgets = node.widgets.filter(w => 
                        w !== node.addTagButton && 
                        !node.dynamicWidgets.some(g => 
                            (g.type === "text" && g.textWidget === w) || 
                            (g.type !== "text" && (g.folder === w || g.file === w))
                        )
                    );
                    
                    // 2. 依新順序加入動態 widget
                    node.widgets = [...staticWidgets];
                    node.dynamicWidgets.forEach(g => {
                        if (g.type === "text") {
                            node.widgets.push(g.textWidget);
                        } else {
                            node.widgets.push(g.folder);
                            node.widgets.push(g.file);
                        }
                    });
                    
                    // 3. 最後加回按鈕
                    if (node.addTagButton) node.widgets.push(node.addTagButton);

                    updateSettings();
                    node.setDirtyCanvas(true, true); // 強制重繪
                };

                // 刪除指定的 Widget 群組
                const removeGroup = (index) => {
                    const group = node.dynamicWidgets[index];
                    
                    // 從 UI 上移除對應的 widget
                    if (group.type === "text") {
                        const tIdx = node.widgets.indexOf(group.textWidget);
                        if (tIdx > -1) node.widgets.splice(tIdx, 1);
                    } else {
                        const fIdx = node.widgets.indexOf(group.folder);
                        if (fIdx > -1) node.widgets.splice(fIdx, 1);
                        const lIdx = node.widgets.indexOf(group.file);
                        if (lIdx > -1) node.widgets.splice(lIdx, 1);
                    }

                    // 從資料結構中移除
                    node.dynamicWidgets.splice(index, 1);

                    updateSettings();
                    node.setSize([node.size[0], node.computeSize()[1]]); // 自動調整節點高度
                    node.setDirtyCanvas(true, true);
                };

                // -----------------------------------------------------------
                // 5. 事件攔截與右鍵選單
                // -----------------------------------------------------------
                
                // 攔截滑鼠點擊位置，判斷是否點擊在某個 Widget 群組上
                const originalGetSlotInPosition = node.getSlotInPosition;
                node.getSlotInPosition = function(canvasX, canvasY) {
                    const slot = originalGetSlotInPosition ? originalGetSlotInPosition.apply(this, arguments) : null;
                    if (slot) return slot; 

                    let foundWidget = null;
                    for (const widget of this.widgets) {
                        if (widget.last_y === undefined) continue; 
                        const widgetHeight = widget.computeSize ? widget.computeSize(node.size[0])[1] : 20; 
                        
                        // 簡單的碰撞檢測
                        if (canvasY >= this.pos[1] + widget.last_y && canvasY < this.pos[1] + widget.last_y + widgetHeight) {
                            foundWidget = widget;
                            break;
                        }
                    }

                    // 若點擊到 Widget，找出它屬於哪個群組
                    if (foundWidget) {
                        const groupIndex = node.dynamicWidgets.findIndex(g => 
                            (g.type === "text" && g.textWidget === foundWidget) || 
                            (g.type !== "text" && (g.folder === foundWidget || g.file === foundWidget))
                        );

                        if (groupIndex !== -1) {
                            // 回傳特殊的 Slot 物件，觸發 getSlotMenuOptions
                            return { 
                                widget: foundWidget, 
                                output: { type: "TAG_GROUP", groupIndex: groupIndex } 
                            };
                        }
                    }
                    return null;
                };

                // 自定義右鍵選單內容
                const originalGetSlotMenuOptions = node.getSlotMenuOptions;
                node.getSlotMenuOptions = function(slot) {
                    if (slot && slot.output && slot.output.type === "TAG_GROUP") {
                        const index = slot.output.groupIndex;
                        const canMoveUp = index > 0; 
                        const canMoveDown = index < node.dynamicWidgets.length - 1; 

                        const menuItems = [
                            {
                                content: "⬆️ Move Up",
                                disabled: !canMoveUp,
                                callback: () => moveGroup(index, -1)
                            },
                            {
                                content: "⬇️ Move Down",
                                disabled: !canMoveDown,
                                callback: () => moveGroup(index, 1)
                            },
                            null, // 分隔線
                            {
                                content: "🗑️ Remove",
                                callback: () => removeGroup(index)
                            }
                        ];
                        
                        new LiteGraph.ContextMenu(menuItems, {
                            title: "Tag Group Options",
                            event: app.canvas.last_mouse_event || window.event 
                        });
                        
                        return null; // 阻止預設選單
                    }
                    
                    return originalGetSlotMenuOptions ? originalGetSlotMenuOptions.apply(this, arguments) : null;
                };

                // -----------------------------------------------------------
                // 6. 核心功能：動態新增 Widget
                // -----------------------------------------------------------
                
                this.addTagInputs = function (defaultFolder = null, defaultFile = null) {
                    // 先移除底部的 "+ Add" 按鈕 (因為新 Widget 要插在它上面)
                    if (node.addTagButton) {
                        const idx = node.widgets.indexOf(node.addTagButton);
                        if (idx !== -1) node.widgets.splice(idx, 1);
                    }

                    const folderNames = Object.keys(node.tagsData);
                    
                    // 建立 Folder 下拉選單
                    const folderWidget = node.addWidget(
                        "combo",
                        `Folder`, 
                        defaultFolder || (folderNames.length > 0 ? folderNames[0] : ""),
                        (v) => {
                            updateFileWidget(v, fileWidget); 
                            updateSettings(); 
                        },
                        { values: folderNames }
                    );

                    // 建立 File 下拉選單
                    const fileWidget = node.addWidget(
                        "combo",
                        `File`,
                        defaultFile || "ALL",
                        () => updateSettings(),
                        { values: [] }
                    );
                    
                    fileWidget.computeSize = () => [0, 35]; // 設定高度

                    // 初始化選項
                    updateFileWidget(folderWidget.value, fileWidget);

                    // 記錄到動態陣列
                    node.dynamicWidgets.push({
                        type: "file",
                        folder: folderWidget,
                        file: fileWidget
                    });

                    // 還原預設值 (如果是讀檔恢復的情況)
                    if (defaultFile && fileWidget.options.values.includes(defaultFile)) {
                        fileWidget.value = defaultFile;
                    }

                    updateSettings();

                    // 加回 "+ Add" 按鈕
                    if (node.addTagButton) {
                        node.widgets.push(node.addTagButton);
                    }

                    // 調整節點大小以適應新內容
                    node.setSize([node.size[0], node.computeSize()[1]]);
                };

                // -----------------------------------------------------------
                // 7. 輔助功能：可搜尋的選單 (Searchable Menu)
                // -----------------------------------------------------------
                
                const createSearchableMenu = (event, values, callback) => {
                    const menu = new LiteGraph.ContextMenu(values, {
                        event: event,
                        callback: callback,
                        scale: 1.3
                    });

                    // 建立搜尋框 DOM
                    const searchInput = document.createElement("input");
                    searchInput.placeholder = "🔍 Search Folder...";
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

                    // 搜尋過濾邏輯：即時隱藏不符合的選項
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

                    // 阻擋事件冒泡，防止輸入時觸發 ComfyUI 快捷鍵
                    searchInput.addEventListener("mouseup", (e) => e.stopPropagation());
                    searchInput.addEventListener("keydown", (e) => e.stopPropagation());

                    menu.root.prepend(searchInput);
                    setTimeout(() => searchInput.focus(), 10);
                };

                // -----------------------------------------------------------
                // 8. 建立新增按鈕與啟動載入
                // -----------------------------------------------------------
                
                node.addTagButton = this.addWidget(
                    "button",
                    "+ Add Tag Group",
                    null,
                    function (value, canvas, node, pos, event) {
                        const folderNames = Object.keys(node.tagsData).sort();
                        
                        if (folderNames.length === 0) {
                            alert("No tags folder found!");
                            return;
                        }

                        // 呼叫自定義搜尋選單
                        createSearchableMenu(
                            event, 
                            folderNames, 
                            (selectedFolder) => {
                                if (selectedFolder) {
                                    node.addTagInputs(selectedFolder, "ALL");
                                }
                            }
                        );
                    }
                );

                // 啟動時：從後端 API 獲取資料並還原上次的設定
                fetch("/custom_nodes/tags")
                    .then(response => response.json())
                    .then(data => {
                        node.tagsData = data;
                        
                        // 檢查是否有儲存的設定並還原
                        if (settingsWidget && settingsWidget.value && settingsWidget.value !== "{}") {
                            try {
                                const savedData = JSON.parse(settingsWidget.value);
                                Object.keys(savedData)
                                    .sort((a, b) => parseInt(a) - parseInt(b)) // 確保順序正確
                                    .forEach(key => {
                                        const item = savedData[key];
                                        if (item.folder) {
                                            this.addTagInputs(item.folder, item.file);
                                        }
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