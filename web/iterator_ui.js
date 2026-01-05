import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI.DynamicTagIterator.UI",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "DynamicTagIterator") {
            
            // 1. 攔截 onNodeCreated 以新增按鈕
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                // 儲存上一次 Seed 的變數
                node.lastExecutedSeed = null;

                // 新增 "Reuse Last Seed" 按鈕
                // 預設標題為 "♻️ Reuse Seed: None"
                node.reuseSeedBtn = node.addWidget("button", "♻️ Reuse Seed: None", null, () => {
                    if (node.lastExecutedSeed !== null) {
                        // 找到名為 "seed" 的輸入框 Widget
                        const seedWidget = node.widgets.find(w => w.name === "seed");
                        if (seedWidget) {
                            seedWidget.value = node.lastExecutedSeed;
                            // 如果有控制後續行為的 widget (control_after_generate)，也可以在這裡設為 fixed
                            // 但通常使用者只想還原數值，我們只改數值即可
                            console.log("[TagIterator] Restored seed:", node.lastExecutedSeed);
                        }
                    } else {
                        alert("No previous seed recorded yet.");
                    }
                });

                return r;
            };

            // 2. 攔截 onExecuted 以接收後端傳來的 Seed
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function(message) {
                const r = onExecuted ? onExecuted.apply(this, arguments) : undefined;
                
                // 檢查是否有回傳 executed_seed
                if (message && message.executed_seed) {
                    const seed = message.executed_seed[0];
                    this.lastExecutedSeed = seed;
                    
                    // 更新按鈕文字，顯示剛剛跑的 Seed
                    if (this.reuseSeedBtn) {
                        this.reuseSeedBtn.name = `♻️ Reuse: ${seed}`;
                        this.setDirtyCanvas(true, true); // 強制重繪節點以顯示新文字
                    }
                }
                return r;
            };
        }
    }
});