import { state } from './globals.js';
import { spawnDroppedItem } from './world.js';
import { RARITY } from './stash.js';
import { playLootCommonSound, playLootLegendarySound } from './audio.js';

let isBackpackOpen = false;
// dragState 现在记录来源库存及索引：{ fromOwner: 'backpack' | 'container', fromIndex: number }
let dragState = null;
let dragElement = null;
let contextMenuEl = null;
let hoverTooltipEl = null;
let hoverTooltipTimer = null;
let overlayContextMenuHandler = null;

// 全局鼠标位置追踪
window.lastMouseX = 0;
window.lastMouseY = 0;
document.addEventListener('mousemove', (e) => {
    window.lastMouseX = e.clientX;
    window.lastMouseY = e.clientY;
});

export function toggleBackpack(forceState) {
    if (!state.isGameActive) return;

    // If forceState is provided, use it (true = open, false = close)
    const newState = forceState !== undefined ? forceState : !isBackpackOpen;

    // If trying to open but game is paused (and not by backpack itself), don't open
    if (newState && state.isPaused && !isBackpackOpen) {
        return;
    }

    isBackpackOpen = newState;
    const overlay = document.getElementById('backpack-overlay');
    
    if (overlay) {
        overlay.style.display = isBackpackOpen ? 'flex' : 'none';
    }

    // 在背包界面打开期间，禁止浏览器默认右键菜单（仅限覆盖层内部）
    if (isBackpackOpen) {
        if (!overlayContextMenuHandler) {
            overlayContextMenuHandler = (e) => {
                const ov = document.getElementById('backpack-overlay');
                if (!ov) return;
                if (ov.contains(e.target)) {
                    e.preventDefault();
                }
            };
            document.addEventListener('contextmenu', overlayContextMenuHandler, true);
        }
    } else if (overlayContextMenuHandler) {
        document.removeEventListener('contextmenu', overlayContextMenuHandler, true);
        overlayContextMenuHandler = null;
    }

    if (isBackpackOpen) {
        // 打开背包时立刻停住玩家自身输入状态（但世界继续运行）
        if (state.moveInput) {
            state.moveInput.f = 0;
            state.moveInput.b = 0;
            state.moveInput.l = 0;
            state.moveInput.r = 0;
        }
        state.isSprinting = false;
        state.isCrouching = false;

        // 仅释放鼠标指针，不修改暂停状态
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
        updateBackpackUI();
    } else {
        // 关闭背包时，如果游戏是激活且未暂停，则尝试重新锁定鼠标
        if (state.isGameActive && !state.isPaused && !document.pointerLockElement) {
            document.body.requestPointerLock();
        }
    }
}

export function isBackpackVisible() {
    return isBackpackOpen;
}

function updateBackpackUI() {
    // Update Stats
    const healthEl = document.getElementById('bp-stat-health');
    const armorEl = document.getElementById('bp-stat-armor');
    const ammoEl = document.getElementById('bp-stat-ammo');
    
    if (healthEl) healthEl.textContent = Math.ceil(state.health);
    if (armorEl) armorEl.textContent = Math.ceil(state.armor) + ' / ' + state.maxArmor;
    if (ammoEl) ammoEl.textContent = state.ammo + ' / ' + state.reserveAmmo;

    // Update Equipped info（与仓库实际装备同步）
    const primaryNameEl = document.getElementById('bp-name-primary');
    const primarySlotEl = document.getElementById('bp-slot-primary');
    if (primaryNameEl) {
        // 优先使用 stash 中真正带入的主武器名称，其次才用 weaponConfig 名称兜底
        const stashPrimary = state.stash && state.stash.equipped && state.stash.equipped.primary;
        const weaponSource = stashPrimary || state.weaponConfig || null;
        const primaryName = weaponSource && weaponSource.name ? weaponSource.name : 'None';

        primaryNameEl.textContent = primaryName;
        // 文本颜色也跟随稀有度：无武器=灰，普通=灰白，其它用稀有度主色
        if (!weaponSource || primaryName === 'None') {
            primaryNameEl.style.color = '#777';
        } else if (weaponSource.rarity && weaponSource.rarity.name) {
            const rName = String(weaponSource.rarity.name).toLowerCase();
            if (rName === 'uncommon') {
                primaryNameEl.style.color = '#60a5fa'; // 蓝
            } else if (rName === 'rare') {
                primaryNameEl.style.color = '#a78bfa'; // 紫
            } else if (rName === 'legendary') {
                primaryNameEl.style.color = '#fbbf24'; // 金
            } else {
                primaryNameEl.style.color = '#e5e7eb'; // 普通：灰白
            }
        } else {
            primaryNameEl.style.color = '#e5e7eb';
        }

        // 根据武器稀有度为 EQUIPPED 槽位添加稀有度样式（逻辑与背包格子一致）
        const rarityClasses = ['rarity-common', 'rarity-uncommon', 'rarity-rare', 'rarity-legendary'];
        if (primarySlotEl) {
            rarityClasses.forEach(cls => primarySlotEl.classList.remove(cls));
            if (weaponSource && weaponSource.rarity && weaponSource.rarity.name) {
                const rName = String(weaponSource.rarity.name).toLowerCase();
                const rarityClass = `rarity-${rName}`;
                primarySlotEl.classList.add(rarityClass);
            }
        }
    }

    const armorNameEl = document.getElementById('bp-name-armor');
    const armorSlotEl = document.getElementById('bp-slot-armor');
    if (armorNameEl) {
        // 优先使用 stash 中真正带入的护甲名称，如果没有再根据 maxArmor 推断/显示 None
        const stashArmor = state.stash && state.stash.equipped && state.stash.equipped.armor;
        let armorLabel = 'None';
        const armorSource = stashArmor || null;

        if (stashArmor && stashArmor.name) {
            armorLabel = stashArmor.name;
        } else if (state.maxArmor > 0) {
            armorLabel = `Tactical Vest (Class ${Math.ceil(state.maxArmor / 50)})`;
        }

        armorNameEl.textContent = armorLabel;
        // 护甲文字颜色：无护甲=灰；有护甲则按稀有度选择颜色，若缺省则灰白
        if (!armorSource && armorLabel === 'None') {
            armorNameEl.style.color = '#777';
        } else if (armorSource && armorSource.rarity && armorSource.rarity.name) {
            const rName = String(armorSource.rarity.name).toLowerCase();
            if (rName === 'uncommon') {
                armorNameEl.style.color = '#60a5fa';
            } else if (rName === 'rare') {
                armorNameEl.style.color = '#a78bfa';
            } else if (rName === 'legendary') {
                armorNameEl.style.color = '#fbbf24';
            } else {
                armorNameEl.style.color = '#e5e7eb';
            }
        } else {
            armorNameEl.style.color = '#e5e7eb';
        }

        // 护甲按稀有度着色 EQUIPPED 槽位（逻辑与背包格子一致）
        const rarityClasses = ['rarity-common', 'rarity-uncommon', 'rarity-rare', 'rarity-legendary'];
        if (armorSlotEl) {
            rarityClasses.forEach(cls => armorSlotEl.classList.remove(cls));
            if (armorSource && armorSource.rarity && armorSource.rarity.name) {
                const rName = String(armorSource.rarity.name).toLowerCase();
                const rarityClass = `rarity-${rName}`;
                armorSlotEl.classList.add(rarityClass);
            }
        }
    }

    // Update Weight and Currency
    const weightEl = document.getElementById('bp-weight-val');
    const currencyEl = document.getElementById('bp-currency-val');
    
    // 不再在背包界面显示负重
    if (weightEl) weightEl.textContent = '';
    // 右下角显示“本局收益”：当前任务得分（state.score），与结算中的 missionScore 对齐
    if (currencyEl) currencyEl.textContent = state.score || 0;

    // Render Grid（玩家背包）
    renderGrid();

    // 如果存在激活的容器，则显示容器窗口并渲染其物品；否则隐藏容器窗口
    const containerWindow = document.getElementById('container-window');
    if (containerWindow) {
        if (state.activeContainer && Array.isArray(state.activeContainer.slots)) {
            containerWindow.style.display = 'flex';
            renderInventoryGrid('container-grid', 'container');
            startContainerIdentificationIfNeeded();
        } else {
            containerWindow.style.display = 'none';
        }
    }
}

function renderGrid() {
    // 目前仅用于玩家背包，将来可以在这里调用其它 owner（例如 container）
    renderInventoryGrid('backpack-grid', 'backpack');
}

function renderInventoryGrid(gridId, owner) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = '';

    let totalSlots = 0;
    let slots = [];
    let readOnly = false;

    if (owner === 'backpack') {
        const backpack = state.backpack;
        totalSlots = backpack && backpack.maxSlots ? backpack.maxSlots : 30;
        slots = backpack && Array.isArray(backpack.slots) ? backpack.slots : [];
        readOnly = false;
    } else if (owner === 'container') {
        const cont = state.activeContainer;
        if (!cont || !Array.isArray(cont.slots)) return;
        totalSlots = cont.maxSlots || cont.slots.length;
        slots = cont.slots;
        // 容器格子支持拖拽与右键，但会根据 identified 状态控制是否允许交互
        readOnly = false;
    } else {
        // 未知 owner：直接返回，避免异常
        return;
    }

    for (let i = 0; i < totalSlots; i++) {
        const cell = document.createElement('div');
        cell.className = 'bp-grid-cell';
        cell.dataset.index = String(i);
        cell.dataset.owner = owner;

        const item = slots[i] || null;
        const isUnidentified = owner === 'container' && item && item.identified === false;

        if (item) {
            cell.classList.add('occupied');

            if (isUnidentified) {
                cell.classList.add('unidentified');
                cell.innerHTML = `
                    <div class="bp-item-icon">?</div>
                `;
            } else {
                // 根据稀有度设置背景颜色
                if (item.rarity && item.rarity.name) {
                    const rarityClass = `rarity-${item.rarity.name.toLowerCase()}`;
                    cell.classList.add(rarityClass);
                }

                // 如果是刚被揭示的物品，追加一个用于触发动画的 class
                if (owner === 'container' && item._justRevealed) {
                    cell.classList.add('reveal-pulse');
                }

                cell.innerHTML = `
                    <div class="bp-item-icon">${item.icon || ''}</div>
                `;
            }
        }

        // 背包格子保留全部交互；容器格子当前仅支持“点击拿取到背包”，不支持拖拽
        if (!readOnly && owner === 'backpack') {
            attachCellEvents(cell, i);
        } else if (owner === 'container') {
            attachContainerCellEvents(cell, i);
        }
        grid.appendChild(cell);
    }
}

function attachContainerCellEvents(cell, index) {
    cell.onmousedown = (e) => {
        // 左键拖拽：从容器拖动物品到背包或其它容器格
        if (e.button !== 0) return;
        e.preventDefault();
        hideHoverTooltip();
        const cont = state.activeContainer;
        if (!cont || !Array.isArray(cont.slots)) return;
        const item = cont.slots[index];
        if (!item) return;
        if (item.identified === false) return; // 未鉴定物品不能拖拽
        startDrag(index, item, e, 'container');
    };

    // 右键：直接尝试将该格物品转移到背包（仅已鉴定物品）
    cell.oncontextmenu = (e) => {
        const cont = state.activeContainer;
        if (!cont || !Array.isArray(cont.slots)) return;
        const item = cont.slots[index];
        if (!item || item.identified === false) return;
        e.preventDefault();
        hideHoverTooltip();
        transferItemFromContainer(index);
    };

    cell.onmouseenter = () => {
        const cont = state.activeContainer;
        if (!cont || !Array.isArray(cont.slots)) return;
        const item = cont.slots[index];
        if (!item) return;
        if (item.identified === false) return; // 未鉴定物品不显示详细信息

        if (hoverTooltipTimer) {
            clearTimeout(hoverTooltipTimer);
            hoverTooltipTimer = null;
        }
        hoverTooltipTimer = setTimeout(() => {
            showHoverTooltip(item);
        }, 200);
    };

    cell.onmouseleave = () => {
        if (hoverTooltipTimer) {
            clearTimeout(hoverTooltipTimer);
            hoverTooltipTimer = null;
        }
        hideHoverTooltip();
    };
}

function startContainerIdentificationIfNeeded() {
    const cont = state.activeContainer;
    if (!cont || !Array.isArray(cont.slots)) return;
    const slots = cont.slots;
    // 不同稀有度使用不同的基础摸索时间：普通最快，传奇最慢
    const rarityExtraDelay = {
        Common: 500,
        Uncommon: 800,
        Rare: 1300,
        Legendary: 2000
    };

    // 每次打开容器时，重置之前的摸金定时器，保证顺序和节奏可预期
    if (Array.isArray(cont._identificationTimers)) {
        for (const id of cont._identificationTimers) {
            clearTimeout(id);
        }
    }
    cont._identificationTimers = [];

    // 构建需要被揭示的格子索引列表，保证按索引顺序依次揭示
    const revealOrder = [];
    for (let i = 0; i < slots.length; i++) {
        const item = slots[i];
        if (!item) continue;
        if (item.identified === true) continue;
        revealOrder.push(i);
    }

    if (revealOrder.length === 0) return;

    let cumulativeDelay = 0;

    revealOrder.forEach((slotIndex) => {
        const item = slots[slotIndex];
        if (!item) return;
        const rarityName = item.rarity && item.rarity.name ? item.rarity.name : 'Common';
        const extra = rarityExtraDelay[rarityName] !== undefined ? rarityExtraDelay[rarityName] : rarityExtraDelay.Common;

        // 当前格子的揭示时间 = 累积时间 + 稀有度额外时间
        cumulativeDelay += extra;
        const revealDelay = cumulativeDelay;

        const timerId = setTimeout(() => {
            // 如果容器已经被关闭或切换，则不再继续
            if (!state.activeContainer || state.activeContainer !== cont) return;
            const current = cont.slots[slotIndex];
            if (!current) return;
            current.identified = true;
            current._justRevealed = true; // 触发 CSS 动画
            // 根据稀有度播放对应的掉落音效：普通/绿/紫用普通音效，金色用红色音效
            if (rarityName === 'Legendary') {
                void playLootLegendarySound();
            } else {
                void playLootCommonSound();
            }
            renderInventoryGrid('container-grid', 'container');

            // 一小段时间后清除“刚揭示”标记，避免后续重复闪烁
            setTimeout(() => {
                if (!state.activeContainer || state.activeContainer !== cont) return;
                const cur2 = cont.slots[slotIndex];
                if (cur2) {
                    delete cur2._justRevealed;
                    renderInventoryGrid('container-grid', 'container');
                }
            }, 400);
        }, revealDelay);

        cont._identificationTimers.push(timerId);
    });
}

function transferItemFromContainer(index) {
    const cont = state.activeContainer;
    if (!cont || !Array.isArray(cont.slots)) return;
    const slots = cont.slots;
    const item = slots[index];
    if (!item) return;

    const placed = addItemToBackpackSlots(item);
    if (!placed) {
        // 背包没有空位
        return;
    }

    // 成功转移后，清空该容器格
    slots[index] = null;

    // 刷新 UI（背包与容器）
    renderGrid();
    if (cont && Array.isArray(cont.slots)) {
        renderInventoryGrid('container-grid', 'container');
    }
}

function addItemToBackpackSlots(item) {
    if (!state.backpack || !Array.isArray(state.backpack.slots)) return false;
    const slots = state.backpack.slots;

    // 简单背包：找第一个空格放一个完整物品实例
    for (let i = 0; i < slots.length; i++) {
        if (!slots[i]) {
            slots[i] = { ...item };
            return true;
        }
    }

    // 没有空位
    return false;
}

function attachCellEvents(cell, index) {
    cell.onmousedown = (e) => {
        if (e.button !== 0) return;
        hideHoverTooltip();
        const backpack = state.backpack;
        if (!backpack || !Array.isArray(backpack.slots)) return;
        const item = backpack.slots[index];
        if (!item) return;
        e.preventDefault();
        hideContextMenu();
        startDrag(index, item, e, 'backpack');
    };

    cell.oncontextmenu = (e) => {
        hideHoverTooltip();
        const backpack = state.backpack;
        if (!backpack || !Array.isArray(backpack.slots)) return;
        const item = backpack.slots[index];
        if (!item) return; // 空格子不弹菜单
        e.preventDefault();
        showContextMenu(index, item, e.clientX, e.clientY);
    };

    cell.onmouseenter = () => {
        // 悬停提示只针对有物品的格子
        const backpack = state.backpack;
        if (!backpack || !Array.isArray(backpack.slots)) return;
        const item = backpack.slots[index];
        if (!item) return;

        if (hoverTooltipTimer) {
            clearTimeout(hoverTooltipTimer);
            hoverTooltipTimer = null;
        }
        hoverTooltipTimer = setTimeout(() => {
            showHoverTooltip(item);
        }, 200); // 缩短到0.2秒
    };

    cell.onmouseleave = () => {
        if (hoverTooltipTimer) {
            clearTimeout(hoverTooltipTimer);
            hoverTooltipTimer = null;
        }
        hideHoverTooltip();
    };
}

function startDrag(index, item, e, owner) {
    dragState = {
        fromIndex: index,
        fromOwner: owner === 'container' ? 'container' : 'backpack'
    };
    dragElement = document.createElement('div');
    dragElement.className = 'bp-drag-item';
    dragElement.style.position = 'fixed';
    dragElement.style.pointerEvents = 'none';
    dragElement.style.zIndex = '9999';
    dragElement.style.transform = 'translate(-50%, -50%)';
    dragElement.style.padding = '4px 8px';
    dragElement.style.borderRadius = '4px';
    dragElement.style.background = 'rgba(15,23,42,0.9)';
    dragElement.style.border = '1px solid rgba(148,163,184,0.9)';
    dragElement.style.fontSize = '18px';
    dragElement.style.color = '#e5e7eb';
    dragElement.innerText = item.icon || '';
    document.body.appendChild(dragElement);
    moveDragElement(e.clientX, e.clientY);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd, { once: true });
}

function moveDragElement(x, y) {
    if (!dragElement) return;
    dragElement.style.left = x + 'px';
    dragElement.style.top = y + 'px';
}

function onDragMove(e) {
    moveDragElement(e.clientX, e.clientY);
}

function onDragEnd(e) {
    document.removeEventListener('mousemove', onDragMove);
    if (!dragState) {
        cleanupDrag();
        return;
    }

    const fromOwner = dragState.fromOwner || 'backpack';
    const fromIndex = dragState.fromIndex;

    const backpack = state.backpack;
    const cont = state.activeContainer;
    const hasBackpack = backpack && Array.isArray(backpack.slots);
    const hasContainer = cont && Array.isArray(cont.slots);

    const backpackGrid = document.getElementById('backpack-grid');
    const containerGrid = document.getElementById('container-grid');
    const bpRect = backpackGrid ? backpackGrid.getBoundingClientRect() : null;
    const ctRect = containerGrid ? containerGrid.getBoundingClientRect() : null;
    const insideBackpackGrid = bpRect
        && e.clientX >= bpRect.left && e.clientX <= bpRect.right
        && e.clientY >= bpRect.top && e.clientY <= bpRect.bottom;
    const insideContainerGrid = ctRect
        && e.clientX >= ctRect.left && e.clientX <= ctRect.right
        && e.clientY >= ctRect.top && e.clientY <= ctRect.bottom;

    const target = document.elementFromPoint(e.clientX, e.clientY);
    let cell = target && target.closest ? target.closest('.bp-grid-cell') : null;

    // 若没有命中任何格子，但鼠标仍在某个 grid 区域内，则吸附到该 grid 中最近的格子
    if ((!cell || cell.dataset.index === undefined) && (insideBackpackGrid || insideContainerGrid)) {
        const grid = insideBackpackGrid ? backpackGrid : containerGrid;
        const cells = grid ? Array.from(grid.querySelectorAll('.bp-grid-cell')) : [];
        let bestCell = null;
        let bestDist = Infinity;
        for (const c of cells) {
            const r = c.getBoundingClientRect();
            const cx = (r.left + r.right) / 2;
            const cy = (r.top + r.bottom) / 2;
            const dx = e.clientX - cx;
            const dy = e.clientY - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestDist) {
                bestDist = d2;
                bestCell = c;
            }
        }
        cell = bestCell;
    }

    // 若仍然没有可用格子，视为拖到界面外
    if (!cell || cell.dataset.index === undefined) {
        // 仅当来源是背包时，允许作为丢弃到世界
        if (fromOwner === 'backpack' && hasBackpack) {
            if (fromIndex >= 0 && fromIndex < backpack.slots.length) {
                const item = backpack.slots[fromIndex];
                if (item) {
                    spawnDroppedItem(item);
                }
                backpack.slots[fromIndex] = null;
                renderGrid();
            }
        }
        cleanupDrag();
        if (hasContainer) {
            renderInventoryGrid('container-grid', 'container');
        }
        return;
    }

    const toIndex = parseInt(cell.dataset.index, 10);
    const toOwner = cell.dataset.owner || 'backpack';
    if (Number.isNaN(toIndex)) {
        cleanupDrag();
        return;
    }

    // 同一库存内部拖拽：简单交换两个格子的物品
    if (fromOwner === toOwner) {
        if (fromOwner === 'backpack' && hasBackpack) {
            if (toIndex === fromIndex) {
                cleanupDrag();
                return;
            }
            const slots = backpack.slots;
            const fromItem = slots[fromIndex] || null;
            const toItem = slots[toIndex] || null;

            const tmp = fromItem;
            slots[fromIndex] = toItem || null;
            slots[toIndex] = tmp || null;
            renderGrid();
        } else if (fromOwner === 'container' && hasContainer) {
            if (toIndex === fromIndex) {
                cleanupDrag();
                if (hasContainer) {
                    renderInventoryGrid('container-grid', 'container');
                }
                return;
            }
            const slots = cont.slots;
            const fromItem = slots[fromIndex] || null;
            const toItem = slots[toIndex] || null;

            const tmp = fromItem;
            slots[fromIndex] = toItem || null;
            slots[toIndex] = tmp || null;
        }
        cleanupDrag();
        if (hasContainer) {
            renderInventoryGrid('container-grid', 'container');
        }
        return;
    }

    // 跨库存拖拽：背包 <-> 容器
    if (fromOwner === 'container' && toOwner === 'backpack' && hasContainer) {
        // 目前容器->背包仍然不使用目标格索引，保持按堆叠/空位逻辑
        transferItemFromContainer(fromIndex);
    } else if (fromOwner === 'backpack' && toOwner === 'container' && hasBackpack && hasContainer) {
        // 背包->容器：优先放入目标槽位（toIndex），不再自动跑到第一个空位
        transferItemFromBackpackToContainer(fromIndex, toIndex);
    }

    cleanupDrag();
    // 刷新两个面板
    renderGrid();
    if (hasContainer) {
        renderInventoryGrid('container-grid', 'container');
    }
}

function transferItemFromBackpackToContainer(index, preferredIndex) {
    const backpack = state.backpack;
    const cont = state.activeContainer;
    if (!backpack || !Array.isArray(backpack.slots)) return;
    if (!cont || !Array.isArray(cont.slots)) return;

    const bSlots = backpack.slots;
    const cSlots = cont.slots;
    const item = bSlots[index];
    if (!item) return;

    // 优先尝试把整件物品放入首选槽位
    if (typeof preferredIndex === 'number' && preferredIndex >= 0 && preferredIndex < cSlots.length) {
        if (!cSlots[preferredIndex]) {
            cSlots[preferredIndex] = { ...item };
            bSlots[index] = null;
            return;
        }
    }

    // 再寻找第一个空位
    for (let i = 0; i < cSlots.length; i++) {
        if (!cSlots[i]) {
            cSlots[i] = { ...item };
            bSlots[index] = null;
            return;
        }
    }

    // 容器没有空间，不做任何修改
}

function cleanupDrag() {
    if (dragElement && dragElement.parentNode) {
        dragElement.parentNode.removeChild(dragElement);
    }
    dragElement = null;
    dragState = null;
}

function showHoverTooltip(item) {
    if (!hoverTooltipEl) {
        hoverTooltipEl = document.createElement('div');
        hoverTooltipEl.className = 'bp-hover-tooltip';
        hoverTooltipEl.style.position = 'fixed';
        hoverTooltipEl.style.zIndex = '10001';
        hoverTooltipEl.style.pointerEvents = 'none';
        document.body.appendChild(hoverTooltipEl);
    }

    const name = item.name || '未知物品';
    const weight = item.weight !== undefined ? item.weight : null;
    const price = item.value !== undefined ? item.value : null;
    const rarityName = item.rarity && (item.rarity.displayName || item.rarity.name) || '';

    const lines = [];
    lines.push(`<div class="bp-tt-name">${name}</div>`);
    if (rarityName) {
        lines.push(`<div class="bp-tt-rarity">${rarityName}</div>`);
    }
    // 不再在物品悬浮提示中显示重量
    if (price !== null) {
        lines.push(`<div class="bp-tt-line">💰 ${price}</div>`);
    }

    // 按稀有度为 tooltip 添加 class，驱动边框/文字颜色
    const rarityClasses = ['rarity-common', 'rarity-uncommon', 'rarity-rare', 'rarity-legendary'];
    rarityClasses.forEach(cls => hoverTooltipEl.classList.remove(cls));
    if (item.rarity && item.rarity.name) {
        const rName = String(item.rarity.name).toLowerCase();
        const rarityClass = `rarity-${rName}`;
        hoverTooltipEl.classList.add(rarityClass);
    }

    hoverTooltipEl.innerHTML = lines.join('');
    hoverTooltipEl.style.display = 'block';

    // 立即更新位置到当前鼠标位置
    updateTooltipPosition({ clientX: window.lastMouseX || 0, clientY: window.lastMouseY || 0 });
    
    // 添加鼠标跟随事件
    document.addEventListener('mousemove', updateTooltipPosition);
}

function updateTooltipPosition(e) {
    if (!hoverTooltipEl || hoverTooltipEl.style.display === 'none') {
        document.removeEventListener('mousemove', updateTooltipPosition);
        return;
    }

    const padding = 12;
    let x = e.clientX + padding;
    let y = e.clientY - 20; // 稍微偏上，避免遮挡鼠标

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ttRect = hoverTooltipEl.getBoundingClientRect();

    // 防止超出屏幕边界
    if (x + ttRect.width > vw - 10) {
        x = e.clientX - ttRect.width - padding;
    }
    if (y + ttRect.height > vh - 10) {
        y = vh - ttRect.height - 10;
    }
    if (y < 10) {
        y = 10;
    }

    hoverTooltipEl.style.left = `${x}px`;
    hoverTooltipEl.style.top = `${y}px`;
}

function hideHoverTooltip() {
    if (hoverTooltipEl) {
        hoverTooltipEl.style.display = 'none';
    }
    // 移除鼠标跟随事件
    document.removeEventListener('mousemove', updateTooltipPosition);
}

// 判断物品是否支持“使用”操作：目前全部返回 false，保留结构以便未来扩展
function canUseItem(item) {
    void item; // 占位，避免未使用参数告警
    return false;
}

function showContextMenu(index, item, x, y) {
    hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'bp-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.zIndex = '10000';
    menu.style.background = 'rgba(15,23,42,0.98)';
    menu.style.border = '1px solid rgba(75,85,99,0.9)';
    menu.style.borderRadius = '4px';
    menu.style.minWidth = '120px';
    menu.style.fontSize = '12px';
    menu.style.color = '#e5e7eb';
    menu.style.boxShadow = '0 10px 30px rgba(0,0,0,0.8)';
    menu.style.padding = '4px 0';

    const addItem = (label, onClick) => {
        const el = document.createElement('div');
        el.textContent = label;
        el.style.padding = '4px 10px';
        el.style.cursor = 'pointer';
        el.style.userSelect = 'none';
        el.addEventListener('mouseenter', () => {
            el.style.background = 'rgba(55,65,81,0.9)';
        });
        el.addEventListener('mouseleave', () => {
            el.style.background = 'transparent';
        });
        el.addEventListener('click', () => {
            onClick();
            hideContextMenu();
        });
        menu.appendChild(el);
    };

    if (canUseItem(item)) {
        addItem('使用', () => {
            useItemAt(index);
        });
    }

    addItem('丢弃', () => {
        dropItemAt(index);
    });

    document.body.appendChild(menu);
    contextMenuEl = menu;

    // 点击其他地方关闭菜单
    const handleClickOutside = (ev) => {
        if (!contextMenuEl) return;
        if (!contextMenuEl.contains(ev.target)) {
            hideContextMenu();
            document.removeEventListener('mousedown', handleClickOutside);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
}

function hideContextMenu() {
    if (contextMenuEl && contextMenuEl.parentNode) {
        contextMenuEl.parentNode.removeChild(contextMenuEl);
    }
    contextMenuEl = null;
}

function useItemAt(index) {
    const backpack = state.backpack;
    if (!backpack || !Array.isArray(backpack.slots)) return;
    const item = backpack.slots[index];
    if (!item) return;

    // 目前物品不再支持堆叠：使用后直接移除该格物品
    backpack.slots[index] = null;
    renderGrid();
}

function dropItemAt(index) {
    const backpack = state.backpack;
    if (!backpack || !Array.isArray(backpack.slots)) return;
    const item = backpack.slots[index];
    if (!item) return;
    // 丢弃：在世界中生成一个掉落物，然后清空该格
    spawnDroppedItem(item);
    backpack.slots[index] = null;
    renderGrid();
}

// 不再支持物品堆叠与分堆，context menu 中已移除相关入口
