/**
 * 產生動態群組管理的通用右鍵選單
 * @param {number} index - 當前被點擊的群組索引
 * @param {number} totalLength - 群組總長度
 * @param {Function} moveCallback - 移動 (index, direction)
 * @param {Function} moveAbsCallback - 絕對移動 (index, "top"|"bottom") [New]
 * @param {Function} insertCallback - 插入 (index, "before"|"after") [New]
 * @param {Function} removeCallback - 移除 (index)
 */
export function getDynamicGroupMenu(index, totalLength, moveCallback, moveAbsCallback, insertCallback, removeCallback) {
    return [
        null,
        // 1. 移動區塊
        {
            content: "⏫ To Top",
            disabled: index === 0,
            callback: () => moveAbsCallback(index, "top")
        },
        { 
            content: "⬆️ Move Up", 
            disabled: index === 0, 
            callback: () => moveCallback(index, -1) 
        },
        { 
            content: "⬇️ Move Down", 
            disabled: index === totalLength - 1, 
            callback: () => moveCallback(index, 1) 
        },        
        {
            content: "⏬ To Bottom",
            disabled: index === totalLength - 1,
            callback: () => moveAbsCallback(index, "bottom")
        },
        null, // 分隔線

        // 2. 插入區塊
        {
            content: "👆 Insert Above",
            callback: () => insertCallback(index, "before")
        },
        {
            content: "👇 Insert Below",
            callback: () => insertCallback(index, "after")
        },
        null, // 分隔線

        // 3. 刪除區塊
        { 
            content: "🗑️ Remove", 
            callback: () => removeCallback(index) 
        }
    ];
}

/**
 * [Updated] 節點尺寸管理器
 * 包含：
 * 1. 防止切換工作流時塌陷 (Restore Logic)
 * 2. 防止新增項目時擠壓現有組件 (Growth Logic)
 */
export function setupSizeManager(node) {
    node._userMinHeight = 0;
    node._isResizing = false;

    // 1. 攔截讀取工作流配置
    const originalOnConfigure = node.onConfigure;
    node.onConfigure = function(data) {
        if (originalOnConfigure) originalOnConfigure.apply(this, arguments);
        if (data && data.size) {
            node._userMinHeight = data.size[1];
        }
    };

    // 2. 攔截使用者手動調整尺寸
    const originalOnResize = node.onResize;
    node.onResize = function(size) {
        if (originalOnResize) originalOnResize.apply(this, arguments);
        if (!node._isResizing) {
            node._userMinHeight = size[1];
        }
    };

    /**
     * [Add Logic] 新增時增高節點 (保持 Text Widget 高度不變)
     */
    node.performAdd = function(action) {
        const startMinHeight = node.computeSize()[1];
        action(); 
        const endMinHeight = node.computeSize()[1];
        const growth = endMinHeight - startMinHeight;

        if (growth > 0) {
            node._isResizing = true;
            const newHeight = node.size[1] + growth;
            node.setSize([node.size[0], newHeight]);
            node._userMinHeight = newHeight; 
            node._isResizing = false;
        }
        node.setDirtyCanvas(true, true);
    };

    /**
     * [Remove Logic] 移除時縮短節點 (New!)
     * 計算移除前後的「內容高度差」，直接從節點總高度扣除
     */
    node.performRemove = function(action) {
        // A. 記錄動作前的「內容所需最小高度」
        const startMinHeight = node.computeSize()[1];

        // B. 執行移除動作
        action();

        // C. 記錄動作後的「內容所需最小高度」
        const endMinHeight = node.computeSize()[1];

        // D. 計算減少量 (Shrink Amount)
        const shrink = startMinHeight - endMinHeight;

        // E. 將減少量應用到「當前節點實際高度」
        if (shrink > 0) {
            node._isResizing = true;
            // 讓節點變矮，這樣多出來的空間就不會被 Text Widget 吃掉
            const newHeight = Math.max(node.size[1] - shrink, endMinHeight);
            node.setSize([node.size[0], newHeight]);
            node._userMinHeight = newHeight; // 同步更新鎖定高度
            node._isResizing = false;
        }
        node.setDirtyCanvas(true, true);
    };

    /**
     * [Restore/Check Logic] 用於載入時或防塌陷檢查
     */
    node.triggerAutoSize = function() {
        const contentMinHeight = node.computeSize()[1];
        const targetHeight = Math.max(contentMinHeight, node._userMinHeight || 0);
        
        node._isResizing = true;
        node.setSize([node.size[0], targetHeight]);
        node._isResizing = false;
        
        node.setDirtyCanvas(true, true);
    };
}
