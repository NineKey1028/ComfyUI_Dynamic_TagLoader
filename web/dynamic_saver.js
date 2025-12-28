import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI.DynamicTagSaver",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "DynamicTagSaver") {

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                // -----------------------------------------------------------
                // 1. 初始化與介面調整
                // -----------------------------------------------------------

                // 隱藏後端通訊用的 Widget (lora_settings)
                const settingsWidget = node.widgets.find(w => w.name === "lora_settings");
                if (settingsWidget) {
                    settingsWidget.type = "hidden";
                    settingsWidget.computeSize = () => [0, -4]; // 設定負高度以完全隱藏
                }

                // 插入視覺分隔線 (Separator Widget)
                // 目的：將一般的檔名設定與下方的 LoRA 列表在視覺上分開
                const filenameIdx = node.widgets.findIndex(w => w.name === "filename");
                if (filenameIdx !== -1) {
                    const separatorWidget = {
                        name: "separator",
                        type: "display", // 標記為顯示專用，不參與邏輯運算
                        computeSize: () => [0, 30], // 設定高度保留空白
                        // 自定義繪製邏輯
                        draw: function(ctx, node, widget_width, y, widget_height) {
                            // 繪製標題文字
                            ctx.fillStyle = "#888"; 
                            ctx.font = "10px Arial";
                            ctx.textAlign = "center";
                            ctx.fillText("▼ LoRA Auto Merge ▼", widget_width * 0.5, y + 18);
                            
                            // 繪製分隔線
                            ctx.strokeStyle = "#444"; 
                            ctx.beginPath();
                            ctx.moveTo(10, y + 24);
                            ctx.lineTo(widget_width - 10, y + 24);
                            ctx.stroke();
                            
                            ctx.textAlign = "left"; // 還原畫布設定
                        }
                    };
                    // 插入至 filename 下方
                    node.widgets.splice(filenameIdx + 1, 0, separatorWidget);
                }

                // 初始化資料結構
                node.loraList = [];       // 儲存從後端抓取的 LoRA 清單
                node.dynamicWidgets = []; // 儲存動態生成的 LoRA 控制項
                node.addLoraButton = null; 

                // -----------------------------------------------------------
                // 2. 資料同步 (UI -> JSON)
                // -----------------------------------------------------------
                
                // 將目前 UI 上的 LoRA 設定序列化為 JSON，存入隱藏欄位
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
                // 3. 群組操作邏輯 (排序與刪除)
                // -----------------------------------------------------------
                
                // 移動 LoRA 群組位置 (上移/下移)
                const moveGroup = (index, direction) => {
                    const newIndex = index + direction;
                    if (newIndex < 0 || newIndex >= node.dynamicWidgets.length) return;

                    // 交換資料陣列位置
                    const temp = node.dynamicWidgets[index];
                    node.dynamicWidgets[index] = node.dynamicWidgets[newIndex];
                    node.dynamicWidgets[newIndex] = temp;

                    // 重建 UI Widget 列表
                    // 注意：必須保留「靜態元件」（如檔名輸入框、我們剛做的分隔線、新增按鈕）
                    const staticWidgets = node.widgets.filter(w => 
                        w !== node.addLoraButton && 
                        !node.dynamicWidgets.some(g => g.loraSelector === w || g.strengthInput === w)
                    );
                    
                    node.widgets = [...staticWidgets];
                    
                    // 依新順序加入動態元件
                    node.dynamicWidgets.forEach(g => {
                        node.widgets.push(g.loraSelector);
                        node.widgets.push(g.strengthInput);
                    });
                    
                    // 最後加回按鈕
                    if (node.addLoraButton) node.widgets.push(node.addLoraButton);

                    updateSettings();
                    node.setDirtyCanvas(true, true);
                };

                // 刪除指定的 LoRA 群組
                const removeGroup = (index) => {
                    const group = node.dynamicWidgets[index];
                    
                    // 移除 UI 元件
                    const lIdx = node.widgets.indexOf(group.loraSelector);
                    if (lIdx > -1) node.widgets.splice(lIdx, 1);
                    const sIdx = node.widgets.indexOf(group.strengthInput);
                    if (sIdx > -1) node.widgets.splice(sIdx, 1);

                    // 移除資料紀錄
                    node.dynamicWidgets.splice(index, 1);

                    updateSettings();
                    node.setSize([node.size[0], node.computeSize()[1]]);
                    node.setDirtyCanvas(true, true);
                };

                // -----------------------------------------------------------
                // 4. 事件互動 (右鍵選單)
                // -----------------------------------------------------------
                
                // 攔截滑鼠點擊，判斷是否點選到 LoRA 群組
                const originalGetSlotInPosition = node.getSlotInPosition;
                node.getSlotInPosition = function(canvasX, canvasY) {
                    const slot = originalGetSlotInPosition ? originalGetSlotInPosition.apply(this, arguments) : null;
                    if (slot) return slot;

                    let foundWidget = null;
                    for (const widget of this.widgets) {
                        if (widget.last_y === undefined) continue; 
                        const widgetHeight = widget.computeSize ? widget.computeSize(node.size[0])[1] : 20; 
                        
                        // 碰撞檢測
                        if (canvasY >= this.pos[1] + widget.last_y && canvasY < this.pos[1] + widget.last_y + widgetHeight) {
                            foundWidget = widget;
                            break;
                        }
                    }

                    if (foundWidget) {
                        const groupIndex = node.dynamicWidgets.findIndex(g => g.loraSelector === foundWidget || g.strengthInput === foundWidget);
                        if (groupIndex !== -1) {
                            // 回傳特殊類型，觸發 getSlotMenuOptions
                            return { widget: foundWidget, output: { type: "LORA_GROUP", groupIndex: groupIndex } };
                        }
                    }
                    return null;
                };

                // 定義右鍵選單內容
                const originalGetSlotMenuOptions = node.getSlotMenuOptions;
                node.getSlotMenuOptions = function(slot) {
                    if (slot && slot.output && slot.output.type === "LORA_GROUP") {
                        const index = slot.output.groupIndex;
                        const canMoveUp = index > 0;
                        const canMoveDown = index < node.dynamicWidgets.length - 1;

                        const menuItems = [
                            { content: "⬆️ Move Up", disabled: !canMoveUp, callback: () => moveGroup(index, -1) },
                            { content: "⬇️ Move Down", disabled: !canMoveDown, callback: () => moveGroup(index, 1) },
                            null,
                            { content: "🗑️ Remove", callback: () => removeGroup(index) }
                        ];
                        
                        new LiteGraph.ContextMenu(menuItems, {
                            title: "LoRA Options",
                            event: app.canvas.last_mouse_event || window.event 
                        });
                        return null;
                    }
                    return originalGetSlotMenuOptions ? originalGetSlotMenuOptions.apply(this, arguments) : null;
                };

                // -----------------------------------------------------------
                // 5. 核心功能：動態新增 LoRA
                // -----------------------------------------------------------
                
                this.addLoraInputs = function (defaultLora = null, defaultStrength = 1.0) {
                    // 暫時移除 "+ Add" 按鈕
                    if (node.addLoraButton) {
                        const idx = node.widgets.indexOf(node.addLoraButton);
                        if (idx !== -1) node.widgets.splice(idx, 1);
                    }

                    const initialLora = defaultLora || (node.loraList.length > 0 ? node.loraList[0] : "None");

                    // 建立 LoRA 選擇器
                    const loraSelector = node.addWidget(
                        "combo",
                        "LoRA Name",
                        initialLora,
                        () => updateSettings(),
                        { values: node.loraList }
                    );

                    // 建立強度數值輸入
                    const strengthInput = node.addWidget(
                        "number",
                        "Strength",
                        defaultStrength,
                        () => updateSettings(),
                        { min: -10.0, max: 10.0, step: 0.1, precision: 2 }
                    );
                    
                    strengthInput.computeSize = () => [0, 30];

                    node.dynamicWidgets.push({
                        loraSelector: loraSelector,
                        strengthInput: strengthInput
                    });

                    updateSettings();

                    // 加回 "+ Add" 按鈕
                    if (node.addLoraButton) {
                        node.widgets.push(node.addLoraButton);
                    }
                    node.setSize([node.size[0], node.computeSize()[1]]);
                };

                // -----------------------------------------------------------
                // 6. 輔助功能：可搜尋的選單
                // -----------------------------------------------------------
                
                const createSearchableMenu = (event, values, callback) => {
                    const menu = new LiteGraph.ContextMenu(values, {
                        event: event,
                        callback: callback,
                        scale: 1.3 
                    });

                    // 建立搜尋輸入框
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

                    // 搜尋過濾邏輯
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

                    // 阻止事件冒泡 (避免觸發 Canvas 縮放等)
                    searchInput.addEventListener("mouseup", (e) => e.stopPropagation());
                    searchInput.addEventListener("keydown", (e) => e.stopPropagation());

                    menu.root.prepend(searchInput);
                    setTimeout(() => searchInput.focus(), 10);
                };

                // -----------------------------------------------------------
                // 7. 啟動與資料載入
                // -----------------------------------------------------------
                
                // 建立 "+ Add LoRA" 按鈕
                node.addLoraButton = this.addWidget(
                    "button",
                    "+ Add LoRA",
                    null,
                    function (value, canvas, node, pos, event) {
                        if (node.loraList.length === 0) {
                            alert("No LoRAs found or list not loaded yet.");
                            return;
                        }
                        // 呼叫搜尋選單
                        createSearchableMenu(
                            event, 
                            node.loraList, 
                            (selectedLora) => {
                                if(selectedLora) {
                                    node.addLoraInputs(selectedLora, 1.0);
                                }
                            }
                        );
                    }
                );

                // 從後端 API 獲取 LoRA 列表並還原設定
                fetch("/custom_nodes/loras_list")
                    .then(response => response.json())
                    .then(data => {
                        node.loraList = ["None", ...data];
                        
                        // 檢查是否有儲存的設定並還原
                        if (settingsWidget && settingsWidget.value && settingsWidget.value !== "{}") {
                            try {
                                const savedData = JSON.parse(settingsWidget.value);
                                Object.keys(savedData)
                                    .sort((a, b) => parseInt(a) - parseInt(b))
                                    .forEach(key => {
                                        const item = savedData[key];
                                        this.addLoraInputs(item.lora_name, item.strength);
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