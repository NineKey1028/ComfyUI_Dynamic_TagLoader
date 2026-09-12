import { app } from "../../scripts/app.js";
import { getDynamicGroupMenu, setupSizeManager } from "./dynamic_utils.js";

function ensureComposerStyles() {
    if (document.getElementById("dynamic-tag-composer-style")) return;
    const style = document.createElement("style");
    style.id = "dynamic-tag-composer-style";
    style.textContent = `
        .dynamic-tag-composer-host { position: relative; box-sizing: border-box; width: 100%; height: 100%; min-height: 96px; }
        .dynamic-tag-composer { position: relative; z-index: 1; box-sizing: border-box; width: 100%; height: 100%; min-height: 96px; padding: 7px; overflow: auto;
            color: #e8e8e8; background: #171725; border: 1px solid #3b3b5b; border-radius: 5px;
            font: 13px/1.5 sans-serif; white-space: pre-wrap; outline: none; }
        .dynamic-tag-composer:focus { border-color: #7698ff; box-shadow: 0 0 0 1px #7698ff66; }
        .dynamic-tag-chip { display: inline-block; margin: 1px 2px; padding: 1px 5px; border: 1px solid #666b75;
            border-radius: 4px; color: #ededf0; background: #3d414a; cursor: pointer; user-select: all; }
        .dynamic-tag-chip.selected { border-color: #ffd267; background: #644b16; color: #fff4d2; }
        .dynamic-tag-completer-proxy { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%;
            margin: 0; padding: 7px; box-sizing: border-box; opacity: 0; pointer-events: none; resize: none; }
        .dynamic-tag-menu { position: fixed; z-index: 10000; max-height: 210px; min-width: 220px; overflow: auto;
            border: 1px solid #4d4d71; border-radius: 5px; background: #1e1e2e; box-shadow: 0 5px 16px #0009; }
        .dynamic-tag-menu button { display: block; width: 100%; padding: 6px 9px; border: 0; text-align: left;
            color: #eee; background: transparent; cursor: pointer; }
        .dynamic-tag-menu button.active, .dynamic-tag-menu button:hover { background: #354f91; }
        .dynamic-tag-menu small { margin-left: 6px; color: #aeb9d2; }
    `;
    document.head.appendChild(style);
}

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
                const textInputWidget = node.widgets.find(w => w.name === "text_input");
                const inlinePromptWidget = node.widgets.find(w => w.name === "inline_prompt");
                for (const widget of [textInputWidget, inlinePromptWidget]) {
                    if (widget) {
                        widget.type = "hidden";
                        widget.computeSize = () => [0, -4];
                    }
                }

                node.tagsData = {};        
                node.dynamicWidgets = [];  
                node.addTagButton = null;  
                node.inlineComposerSegments = [];
                node.inlineComposerSelectedChip = null;
                ensureComposerStyles();

                const tagKey = (folder, file) => `${folder}/${file}`;
                const chipLabel = (folder, file) => tagKey(folder, file).replace(/\.txt$/i, "");
                const chipWeightSuffix = (strength) => `:${Number(strength)})`;
                const getTagEntries = () => Object.entries(node.tagsData)
                    .flatMap(([folder, files]) => files
                        .filter(file => file !== "ALL" && file.endsWith(".txt"))
                        .map(file => ({ folder, file, label: tagKey(folder, file) })));

                const updateInlinePrompt = () => {
                    if (inlinePromptWidget) inlinePromptWidget.value = JSON.stringify(node.inlineComposerSegments);
                    // Once the composer has been used, avoid falling back to a
                    // stale legacy Global Prompt when every segment is deleted.
                    if (textInputWidget) textInputWidget.value = "";
                };

                const normaliseSegments = (segments) => segments.reduce((result, item) => {
                    if (item.type === "text") {
                        const text = String(item.text || "");
                        if (!text) return result;
                        const previous = result[result.length - 1];
                        if (previous?.type === "text") previous.text += text;
                        else result.push({ type: "text", text });
                    } else if (item.type === "tag" && item.folder && item.file) {
                        result.push({ type: "tag", folder: item.folder, file: item.file, strength: Number(item.strength ?? 1) });
                    }
                    return result;
                }, []);

                const makeChip = (segment) => {
                    // Keep chips directly in the editor's text flow. An
                    // editable inline wrapper confuses native vertical caret
                    // navigation when a line consists only of a chip.
                    const token = document.createDocumentFragment();
                    const chip = document.createElement("span");
                    chip.className = "dynamic-tag-chip";
                    chip.contentEditable = "false";
                    chip.dataset.folder = segment.folder;
                    chip.dataset.file = segment.file;
                    chip.dataset.strength = String(segment.strength ?? 1);
                    chip.textContent = chipLabel(segment.folder, segment.file);
                    chip.title = "Ctrl + ↑ / ↓ 調整強度；Backspace 或 Delete 刪除";
                    const selectChip = (event) => {
                        event.preventDefault();
                        node.inlineComposerSelectedChip?.classList.remove("selected");
                        node.inlineComposerSelectedChip = chip;
                        chip.classList.add("selected");
                        composer.focus();
                        // Clicking a non-editable chip can leave its label (or
                        // the previous weight edit) selected in the browser.
                        // Keep chip selection in our state and a collapsed DOM
                        // caret so the attention bridge resolves its enclosure.
                        const range = document.createRange();
                        range.setStartBefore(chip);
                        range.collapse(true);
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                    };
                    chip.addEventListener("click", selectChip);

                    if (Number(segment.strength ?? 1) === 1) token.append(chip);
                    else token.append("(", chip, chipWeightSuffix(segment.strength));
                    return token;
                };

                const composer = document.createElement("div");
                composer.className = "dynamic-tag-composer";
                composer.contentEditable = "true";
                composer.spellcheck = false;
                composer.setAttribute("aria-label", "Prompt Composer. Type @ to insert a tag.");
                const composerHost = document.createElement("div");
                composerHost.className = "dynamic-tag-composer-host";
                composerHost.appendChild(composer);
                // ExTagComplete is textarea-based.  This invisible proxy lets
                // its own dropdown/search logic work while the visible editor
                // remains a chip-capable contenteditable surface.
                const exTagProxy = document.createElement("textarea");
                exTagProxy.className = "dynamic-tag-completer-proxy";
                exTagProxy.tabIndex = -1;
                exTagProxy.setAttribute("aria-hidden", "true");
                composerHost.appendChild(exTagProxy);
                const menu = document.createElement("div");
                menu.className = "dynamic-tag-menu";
                menu.hidden = true;
                document.body.appendChild(menu);

                const serializeComposer = () => {
                    const segments = [];
                    const appendText = (text) => segments.push({ type: "text", text });
                    const walk = (element) => {
                        for (const child of element.childNodes) {
                            if (child.nodeType === Node.TEXT_NODE) appendText(child.nodeValue);
                            else if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains("dynamic-tag-chip")) {
                                segments.push({ type: "tag", folder: child.dataset.folder, file: child.dataset.file, strength: 1 });
                            } else if (child.nodeName === "BR") appendText("\n");
                            else walk(child);
                        }
                    };
                    walk(composer);
                    node.inlineComposerSegments = normaliseSegments(segments);
                    updateInlinePrompt();
                };

                const renderComposer = () => {
                    composer.replaceChildren();
                    node.inlineComposerSegments.forEach(segment => {
                        composer.append(segment.type === "tag" ? makeChip(segment) : document.createTextNode(segment.text));
                    });
                    if (!composer.childNodes.length) composer.append(document.createTextNode(""));
                    node.inlineComposerSelectedChip = null;
                };

                const getTrigger = () => {
                    const selection = window.getSelection();
                    if (!selection?.rangeCount || !composer.contains(selection.focusNode) || selection.focusNode?.nodeType !== Node.TEXT_NODE) return null;
                    const before = selection.focusNode.nodeValue.slice(0, selection.focusOffset);
                    const match = before.match(/(?:^|[\s,])@([^\s,@]*)$/);
                    return match ? { selection, textNode: selection.focusNode, start: selection.focusOffset - match[0].length + (match[0].startsWith("@") ? 0 : 1), query: match[1] } : null;
                };

                let menuEntries = [];
                let menuIndex = 0;
                const closeMenu = () => { menu.hidden = true; menu.replaceChildren(); };
                const insertTagFromMenu = (entry) => {
                    const trigger = getTrigger();
                    if (!trigger) return closeMenu();
                    const range = document.createRange();
                    range.setStart(trigger.textNode, trigger.start);
                    range.setEnd(trigger.textNode, trigger.selection.focusOffset);
                    range.deleteContents();
                    const chip = makeChip({ ...entry, strength: 1 });
                    const lastInserted = chip.lastChild;
                    range.insertNode(chip);
                    range.setStartAfter(lastInserted);
                    range.collapse(true);
                    trigger.selection.removeAllRanges();
                    trigger.selection.addRange(range);
                    closeMenu();
                    serializeComposer();
                    composer.focus();
                };
                const showMenu = () => {
                    const trigger = getTrigger();
                    if (!trigger) {
                        closeMenu();
                        return false;
                    }
                    // A newly typed @ always starts at the first result. Keep
                    // the current index only while navigating the open menu.
                    if (menu.hidden) menuIndex = 0;
                    const query = trigger.query.toLowerCase();
                    menuEntries = getTagEntries().filter(entry => entry.label.toLowerCase().includes(query)).slice(0, 30);
                    if (!menuEntries.length) {
                        closeMenu();
                        return false;
                    }
                    menuIndex = Math.min(menuIndex, menuEntries.length - 1);
                    menu.replaceChildren(...menuEntries.map((entry, index) => {
                        const button = document.createElement("button");
                        button.className = index === menuIndex ? "active" : "";
                        button.textContent = `@${entry.label.replace(/\.txt$/i, "")}`;
                        button.addEventListener("mousedown", event => { event.preventDefault(); insertTagFromMenu(entry); });
                        return button;
                    }));
                    const rect = composer.getBoundingClientRect();
                    menu.style.left = `${rect.left}px`;
                    menu.style.top = `${Math.min(rect.bottom + 3, window.innerHeight - 220)}px`;
                    menu.hidden = false;
                    return true;
                };

                const adjacentChip = (direction) => {
                    const selection = window.getSelection();
                    if (!selection?.rangeCount || !selection.isCollapsed) return null;
                    let container = selection.focusNode;
                    let sibling = null;
                    if (container?.nodeType === Node.TEXT_NODE) {
                        if ((direction < 0 && selection.focusOffset !== 0) || (direction > 0 && selection.focusOffset !== container.nodeValue.length)) return null;
                        sibling = direction < 0 ? container.previousSibling : container.nextSibling;
                    } else if (container === composer) {
                        sibling = composer.childNodes[selection.focusOffset + (direction < 0 ? -1 : 0)];
                    }
                    if (sibling?.nodeType !== Node.ELEMENT_NODE) return null;
                    return sibling.classList.contains("dynamic-tag-chip") ? sibling : null;
                };

                const moveFromSelectedChip = (direction) => {
                    const chip = node.inlineComposerSelectedChip;
                    if (!chip) return false;
                    const rect = chip.getBoundingClientRect();
                    const lineHeight = Number.parseFloat(getComputedStyle(composer).lineHeight) || rect.height;
                    const pointY = direction < 0 ? rect.top - lineHeight / 2 : rect.bottom + lineHeight / 2;
                    const pointX = rect.left + Math.min(rect.width / 2, 8);
                    const caret = document.caretPositionFromPoint?.(pointX, pointY);
                    const range = caret
                        ? (() => {
                            const next = document.createRange();
                            next.setStart(caret.offsetNode, caret.offset);
                            next.collapse(true);
                            return next;
                        })()
                        : document.caretRangeFromPoint?.(pointX, pointY);
                    if (!range || !composer.contains(range.startContainer)) return false;
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    chip.classList.remove("selected");
                    node.inlineComposerSelectedChip = null;
                    return true;
                };

                const editAttentionWithNativeRules = (direction) => {
                    const selection = window.getSelection();
                    const native = window.comfyAPI?.editAttention;
                    if (!native || !selection?.rangeCount || !composer.contains(selection.anchorNode)) return false;
                    const selected = selection.getRangeAt(0);
                    const prefix = selected.cloneRange();
                    prefix.selectNodeContents(composer);
                    prefix.setEnd(selected.startContainer, selected.startOffset);
                    let start = prefix.toString().length;
                    let end = start + selected.toString().length;
                    const value = composer.textContent;
                    const chip = node.inlineComposerSelectedChip;
                    if (chip && selection.isCollapsed) {
                        prefix.selectNodeContents(composer);
                        prefix.setEndBefore(chip);
                        start = prefix.toString().length;
                        end = start + chip.textContent.length;

                        // Parentheses and weights are ordinary editable text.
                        // When the clicked chip is already inside a weighted
                        // enclosure, adjust that enclosure instead of nesting
                        // another pair around the chip.
                        const enclosure = native.findNearestEnclosure(value, start);
                        if (enclosure && enclosure.start <= start && enclosure.end >= end
                            && value[enclosure.start - 1] === "(" && value[enclosure.end] === ")") {
                            const weighted = value.slice(enclosure.start - 1, enclosure.end + 1);
                            if (/^\([\s\S]*:[+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?\)$/.test(weighted)) {
                                start = enclosure.start - 1;
                                end = enclosure.end + 1;
                            }
                        }
                    }
                    let text = value.slice(start, end);
                    if (!text) {
                        const enclosure = native.findNearestEnclosure(value, start);
                        if (enclosure) {
                            start = enclosure.start;
                            end = enclosure.end;
                        } else {
                            const delimiters = " .,\\/!?%^*;:{}=-_`~()\r\n\t";
                            while (start > 0 && !delimiters.includes(value[start - 1])) start--;
                            while (end < value.length && !delimiters.includes(value[end])) end++;
                        }
                        text = value.slice(start, end);
                        if (!text) return false;
                    }
                    if (text.endsWith(" ")) { text = text.slice(0, -1); end--; }
                    if (value[start - 1] === "(" && value[end] === ")") {
                        start--;
                        end++;
                        text = value.slice(start, end);
                    }
                    if (!text.startsWith("(") || !text.endsWith(")")) text = `(${text})`;
                    text = native.addWeightToParentheses(text);
                    const delta = Number(app.ui.settings.getSettingValue("Comfy.EditAttention.Delta", 0.05));
                    const replacement = text.replace(/\((.*):([+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?)\)/,
                        (_, body, weight) => {
                            const next = native.incrementWeight(weight, direction * delta);
                            return Number(next) === 1 ? body : `(${body}:${next})`;
                        });
                    const range = rangeAtComposerTextOffset(start);
                    const endRange = rangeAtComposerTextOffset(end);
                    range.setEnd(endRange.startContainer, endRange.startOffset);
                    const refs = [...range.cloneContents().querySelectorAll(".dynamic-tag-chip")];
                    let portable = replacement;
                    for (const ref of refs) portable = portable.replace(ref.textContent,
                        `@{${tagKey(ref.dataset.folder, ref.dataset.file)}}`);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    pasteTextIntoComposer(portable, true);
                    return true;
                };

                let exTagCompleter = null;
                let exTagProxyValue = "";
                let syncingExTagProxy = false;
                const textOffsetAt = (container, offset) => {
                    const range = document.createRange();
                    range.selectNodeContents(composer);
                    range.setEnd(container, offset);
                    return range.toString().length;
                };
                const composerSelectionOffsets = () => {
                    const selection = window.getSelection();
                    if (!selection?.rangeCount || !composer.contains(selection.anchorNode)) return null;
                    const range = selection.getRangeAt(0);
                    let start = textOffsetAt(range.startContainer, range.startOffset);
                    let end = textOffsetAt(range.endContainer, range.endOffset);
                    const chip = node.inlineComposerSelectedChip;
                    if (chip && selection.isCollapsed) {
                        const before = document.createRange();
                        before.selectNodeContents(composer);
                        before.setEndBefore(chip);
                        start = before.toString().length;
                        end = start + chip.textContent.length;
                    }
                    return { start, end };
                };
                const rangeAtComposerTextOffset = (offset) => {
                    const walker = document.createTreeWalker(composer, NodeFilter.SHOW_TEXT);
                    let textNode;
                    let remaining = Math.max(0, offset);
                    while ((textNode = walker.nextNode())) {
                        const length = textNode.nodeValue.length;
                        if (remaining <= length) {
                            const range = document.createRange();
                            const chip = textNode.parentElement?.closest('.dynamic-tag-chip');
                            if (chip && remaining === 0) range.setStartBefore(chip);
                            else if (chip && remaining === length) range.setStartAfter(chip);
                            else range.setStart(textNode, remaining);
                            range.collapse(true);
                            return range;
                        }
                        remaining -= length;
                    }
                    const range = document.createRange();
                    range.selectNodeContents(composer);
                    range.collapse(false);
                    return range;
                };
                const syncExTagProxy = (emitInput = true) => {
                    const offsets = composerSelectionOffsets();
                    if (!offsets) return;
                    exTagProxyValue = composer.textContent;
                    exTagProxy.value = exTagProxyValue;
                    exTagProxy.setSelectionRange(offsets.start, offsets.end);
                    if (!emitInput) return;
                    syncingExTagProxy = true;
                    exTagProxy.dispatchEvent(new Event("input", { bubbles: true }));
                    syncingExTagProxy = false;
                };
                exTagProxy.addEventListener("input", () => {
                    if (syncingExTagProxy || exTagProxy.value === exTagProxyValue) return;
                    const before = exTagProxyValue;
                    const after = exTagProxy.value;
                    let start = 0;
                    while (start < before.length && start < after.length && before[start] === after[start]) start++;
                    let beforeEnd = before.length;
                    let afterEnd = after.length;
                    while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
                        beforeEnd--;
                        afterEnd--;
                    }
                    const range = rangeAtComposerTextOffset(start);
                    const endRange = rangeAtComposerTextOffset(beforeEnd);
                    range.setEnd(endRange.startContainer, endRange.startOffset);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    const refs = [...range.cloneContents().querySelectorAll(".dynamic-tag-chip")];
                    let inserted = after.slice(start, afterEnd);
                    for (const ref of refs) inserted = inserted.replace(ref.textContent,
                        "@{" + tagKey(ref.dataset.folder, ref.dataset.file) + "}");
                    pasteTextIntoComposer(inserted);
                    exTagProxyValue = after;
                });
                import("/extensions/comfy-ex-tagcomplete/tag-complete/tag_completer.js")
                    .then(({ TagCompleter }) => {
                        // The import can finish after an undo/workflow reload
                        // has already removed this node.
                        if (composerDisposed) return;
                        exTagCompleter = new TagCompleter(exTagProxy);
                    })
                    // ExTagComplete is optional; this node remains usable when
                    // the extension is not installed or uses a different URL.
                    .catch(() => {});

                composer.addEventListener("input", () => {
                    serializeComposer();
                    if (!showMenu()) syncExTagProxy();
                });
                composer.addEventListener("click", event => {
                    if (event.target === composer) {
                        node.inlineComposerSelectedChip?.classList.remove("selected");
                        node.inlineComposerSelectedChip = null;
                    }
                });
                // LiteGraph assigns single-letter shortcuts (including F) to
                // the canvas. A contenteditable element is not treated like a
                // native textarea by every frontend build, so keep typing
                // events inside this editor.
                for (const type of ["keypress", "keyup"]) {
                    composer.addEventListener(type, event => {
                        if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
                    });
                }
                composer.addEventListener("keydown", event => {
                    // Plain typing must not reach LiteGraph's single-letter
                    // shortcuts. Modified commands such as Ctrl+Enter keep
                    // bubbling to ComfyUI's native command handler.
                    if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                        // Preserve the browser's native Select All inside the
                        // editor without letting LiteGraph select graph nodes.
                        event.stopPropagation();
                        return;
                    }
                    if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                        if (editAttentionWithNativeRules(event.key === "ArrowUp" ? 1 : -1)) {
                            event.preventDefault();
                            event.stopImmediatePropagation();
                        }
                        return;
                    }
                    if (!menu.hidden && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) {
                        event.preventDefault();
                        if (event.key === "Escape") return closeMenu();
                        if (event.key === "Enter") return insertTagFromMenu(menuEntries[menuIndex]);
                        menuIndex = (menuIndex + (event.key === "ArrowDown" ? 1 : -1) + menuEntries.length) % menuEntries.length;
                        return showMenu();
                    }
                    if (exTagCompleter?.dropdownController?.isVisible() && ["ArrowUp", "ArrowDown", "Enter", "Escape", "PageUp", "PageDown"].includes(event.key)) {
                        event.preventDefault();
                        exTagProxy.dispatchEvent(new KeyboardEvent("keydown", {
                            key: event.key,
                            code: event.code,
                            bubbles: true,
                            cancelable: true,
                        }));
                        return;
                    }
                    if ((event.key === "ArrowUp" || event.key === "ArrowDown")
                        && moveFromSelectedChip(event.key === "ArrowUp" ? -1 : 1)) {
                        event.preventDefault();
                        return;
                    }
                    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                        node.inlineComposerSelectedChip?.classList.remove("selected");
                        node.inlineComposerSelectedChip = null;
                    }
                    if (event.key === "Backspace" || event.key === "Delete") {
                        if (node.inlineComposerSelectedChip) {
                            event.preventDefault();
                            node.inlineComposerSelectedChip.remove();
                            node.inlineComposerSelectedChip = null;
                            serializeComposer();
                            return;
                        }
                        const chip = adjacentChip(event.key === "Backspace" ? -1 : 1);
                        if (chip) {
                            event.preventDefault();
                            chip.remove();
                            node.inlineComposerSelectedChip = null;
                            serializeComposer();
                        }
                    }
                });
                const serializeClipboardText = () => {
                    const selection = window.getSelection();
                    if (!selection?.rangeCount || !composer.contains(selection.anchorNode)) return "";
                    const fragment = selection.getRangeAt(0).cloneContents();
                    const asElement = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
                    const anchorChip = asElement(selection.anchorNode)?.closest('.dynamic-tag-chip');
                    const focusChip = asElement(selection.focusNode)?.closest('.dynamic-tag-chip');
                    // Selecting the label itself clones a text node, not its
                    // enclosing span. Preserve the reference in this case too.
                    if (anchorChip && anchorChip === focusChip) {
                        return '@{' + tagKey(anchorChip.dataset.folder, anchorChip.dataset.file) + '}';
                    }
                    fragment.querySelectorAll(".dynamic-tag-chip").forEach(chip =>
                        chip.replaceWith(document.createTextNode("@{" + tagKey(chip.dataset.folder, chip.dataset.file) + "}")));
                    return fragment.textContent;
                };
                const pasteTextIntoComposer = (pasted, selectInserted = false) => {
                    const selection = window.getSelection();
                    if (!selection?.rangeCount || !composer.contains(selection.anchorNode)) return false;
                    const range = selection.getRangeAt(0);
                    range.deleteContents();
                    const fragment = document.createDocumentFragment();
                    // Browser/native clipboard handlers may supply only visible
                    // labels. Recognise exact library paths as well as our
                    // portable references; leave unknown text untouched.
                    const appendPlainText = (text) => {
                        const entries = getTagEntries().map(entry => ({...entry,
                            visible: chipLabel(entry.folder, entry.file)}))
                            .sort((a, b) => b.visible.length - a.visible.length);
                        let offset = 0;
                        let plain = '';
                        while (offset < text.length) {
                            const entry = entries.find(entry => text.startsWith(entry.visible, offset)
                                && (offset === 0 || /[\s,(]/.test(text[offset - 1]))
                                && (offset + entry.visible.length === text.length
                                    || /[\s,:)]/.test(text[offset + entry.visible.length])));
                            if (entry) {
                                if (plain) fragment.append(document.createTextNode(plain));
                                plain = '';
                                fragment.append(makeChip({...entry, strength: 1}));
                                offset += entry.visible.length;
                            } else plain += text[offset++];
                        }
                        if (plain) fragment.append(document.createTextNode(plain));
                    };
                    const matcher = /@\{([^}]+)\}/g;
                    let lastIndex = 0;
                    let match;
                    while ((match = matcher.exec(pasted))) {
                        appendPlainText(pasted.slice(lastIndex, match.index));
                        const parts = match[1].match(/^(.*?)(?:::([+-]?[\d.]+))?$/);
                        const reference = parts[1];
                        const slash = reference.lastIndexOf("/");
                        if (slash >= 0 && reference.endsWith(".txt")) {
                            fragment.append(makeChip({folder: reference.slice(0, slash), file: reference.slice(slash + 1),
                                strength: parts[2] === undefined ? 1 : Number(parts[2])}));
                        } else fragment.append(document.createTextNode(match[0]));
                        lastIndex = matcher.lastIndex;
                    }
                    appendPlainText(pasted.slice(lastIndex).replace(/\r\n/g, "\n"));
                    if (!fragment.childNodes.length) fragment.append(document.createTextNode(''));
                    const first = fragment.firstChild;
                    const last = fragment.lastChild;
                    range.insertNode(fragment);
                    range.setStartBefore(first);
                    range.setEndAfter(last);
                    if (!selectInserted) range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    node.inlineComposerSelectedChip?.classList.remove("selected");
                    node.inlineComposerSelectedChip = null;
                    serializeComposer();
                    return true;
                };
                composer.__dynamicTagClipboard = { serializeClipboardText, pasteTextIntoComposer };
                composer.addEventListener("copy", event => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    event.clipboardData.setData("text/plain", serializeClipboardText());
                });
                composer.addEventListener("paste", event => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    pasteTextIntoComposer(event.clipboardData.getData("text/plain"));
                });

                // contenteditable is not recognised as a text field by every
                // LiteGraph frontend. Guard the global graph clipboard path so
                // Ctrl+V never pastes a copied node beside this editor.
                if (!document.__dynamicTagClipboardGuardInstalled) {
                    document.__dynamicTagClipboardGuardInstalled = true;
                    const activeComposer = () => {
                        const focused = document.activeElement?.closest?.('.dynamic-tag-composer');
                        if (focused) return focused;
                        const anchor = window.getSelection()?.anchorNode;
                        return (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)
                            ?.closest?.('.dynamic-tag-composer');
                    };
                    window.addEventListener("copy", event => {
                        const active = activeComposer();
                        if (!active?.__dynamicTagClipboard || !event.clipboardData) return;
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        event.clipboardData.setData("text/plain", active.__dynamicTagClipboard.serializeClipboardText());
                    }, true);
                    window.addEventListener("paste", event => {
                        const active = activeComposer();
                        if (!active?.__dynamicTagClipboard) return;
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        active.__dynamicTagClipboard.pasteTextIntoComposer(event.clipboardData?.getData("text/plain") || "");
                    }, true);
                    const patchGraphPaste = () => {
                        const canvas = app.canvas;
                        const wrap = (target, key) => {
                            if (!target || typeof target[key] !== "function" || target[key].__dynamicTagClipboardPatched) return;
                            const original = target[key];
                            const guarded = function(...args) {
                                if (activeComposer()) return null;
                                return original.apply(this, args);
                            };
                            guarded.__dynamicTagClipboardPatched = true;
                            target[key] = guarded;
                        };
                        wrap(canvas, "pasteFromClipboard");
                        wrap(canvas?.constructor?.prototype, "pasteFromClipboard");
                        wrap(globalThis.LiteGraph?.LGraphCanvas?.prototype, "pasteFromClipboard");
                    };
                    patchGraphPaste();
                    queueMicrotask(patchGraphPaste);
                    setTimeout(patchGraphPaste, 0);
                }

                // DOM widgets sit above the LiteGraph canvas and therefore
                // absorb its wheel event. Forward it so canvas zoom remains
                // available even while the insertion caret is in this editor.
                composer.addEventListener("wheel", event => {
                    const canvas = app.canvas?.canvas;
                    if (!canvas) return;
                    event.preventDefault();
                    event.stopPropagation();
                    canvas.dispatchEvent(new WheelEvent("wheel", {
                        deltaX: event.deltaX,
                        deltaY: event.deltaY,
                        deltaZ: event.deltaZ,
                        deltaMode: event.deltaMode,
                        clientX: event.clientX,
                        clientY: event.clientY,
                        ctrlKey: event.ctrlKey,
                        shiftKey: event.shiftKey,
                        altKey: event.altKey,
                        metaKey: event.metaKey,
                        bubbles: true,
                        cancelable: true,
                    }));
                }, { passive: false });

                // Use ComfyUI's native DOM-widget layer instead of a manually
                // positioned overlay.  It owns canvas transforms, visibility,
                // zoom, and the size assigned to a resized node.
                const composerWidget = node.addDOMWidget("prompt_composer", "prompt_composer", composerHost, {
                    serialize: false,
                    hideOnZoom: false,
                    getMinHeight: () => 116,
                    getValue: () => "",
                    setValue: () => {},
                });
                // A fixed computeSize prevents LiteGraph from giving a DOM
                // widget the extra height the user creates by resizing a node.
                // Keep only a minimum; the editor then fills its allocated slot.
                try {
                    delete composerWidget.computeSize;
                } catch {
                    composerWidget.computeSize = undefined;
                }
                composerWidget.computeLayoutSize = () => ({ minHeight: 116, maxHeight: undefined, minWidth: 0 });
                if (composerWidget.options) {
                    composerWidget.options.getMinHeight = () => 116;
                    delete composerWidget.options.getMaxHeight;
                    delete composerWidget.options.getHeight;
                }
                const composerInsertAt = node.widgets.indexOf(textInputWidget);
                const composerCurrentIndex = node.widgets.indexOf(composerWidget);
                if (composerCurrentIndex >= 0) {
                    node.widgets.splice(composerCurrentIndex, 1);
                    node.widgets.splice(composerInsertAt >= 0 ? composerInsertAt + 1 : 0, 0, composerWidget);
                }

                const originalOnRemoved = node.onRemoved;
                const originalWidgetOnRemove = composerWidget.onRemove;
                let composerDisposed = false;
                const disposeComposer = () => {
                    if (composerDisposed) return;
                    composerDisposed = true;
                    closeMenu();
                    menu.remove();
                    try { exTagCompleter?.destroy?.(); } catch { /* optional integration */ }
                    exTagCompleter = null;
                    delete composer.__dynamicTagClipboard;
                    composerHost.remove();
                    if (node.inlineComposerSelectedChip?.isConnected === false) {
                        node.inlineComposerSelectedChip = null;
                    }
                };
                composerWidget.onRemove = function() {
                    disposeComposer();
                    return originalWidgetOnRemove?.apply(this, arguments);
                };
                node.onRemoved = function() {
                    disposeComposer();
                    return originalOnRemoved?.apply(this, arguments);
                };

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
                    const uid = Math.random().toString(36).substring(2, 7);
                    const folderWidget = node.addWidget("combo", "Folder_" + uid, defaultFolder || (folderNames.length > 0 ? folderNames[0] : ""), (v) => {
                        updateFileWidget(v, fileWidget); 
                        updateSettings(); 
                    }, { values: folderNames });
                    folderWidget.label = "Folder";

                    const fileWidget = node.addWidget("combo", "File_" + uid, defaultFile || "ALL", () => updateSettings(), { values: [] });
                    fileWidget.label = "File";
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
                        try {
                            const savedSegments = JSON.parse(inlinePromptWidget?.value || "[]");
                            if (Array.isArray(savedSegments) && savedSegments.length) {
                                node.inlineComposerSegments = normaliseSegments(savedSegments);
                            } else if (textInputWidget?.value) {
                                // Upgrade old workflows in memory without changing
                                // their legacy field; saving writes the new format.
                                node.inlineComposerSegments = [{ type: "text", text: textInputWidget.value }];
                                updateInlinePrompt();
                            }
                        } catch (error) {
                            console.warn("Unable to restore Prompt Composer", error);
                        }
                        renderComposer();
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
