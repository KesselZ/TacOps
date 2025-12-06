import { state } from './globals.js';
import { updateNickname, updateCurrency } from './backend_client.js';
import { colyseusClient } from './colyseusClient.js';
import { ITEM_TYPE, EQUIP_SLOT } from './stash.js';
import { saveCurrency, isFirstTimePlayer, markPlayerHasPlayed } from './persistence.js';
import { buildWeapon } from './weapon.js';
import { CONFIG } from './config.js';
import { playEquipSound } from './audio.js';

// 导出ITEM_TYPE用于过滤
const AMMO_GRADE = ITEM_TYPE.AMMO_GRADE;

export function renderStashUI() {
    if (!state.stash) return;
    
    // 渲染仓库格子
    renderStashGrid();
    
    // 渲染装备槽
    renderEquipmentSlots();
    
    // 更新统计信息
    updateStashStats();
    
    // 只在第一次玩时为deploy按钮添加提示光晕
    const deployBtn = document.getElementById('deploy-btn');
    if (deployBtn) {
        if (isFirstTimePlayer()) {
            deployBtn.classList.add('hint-glow');
        } else {
            deployBtn.classList.remove('hint-glow');
        }
    }
}

// --- Multiplayer room list rendering ---

function renderRoomList(rooms) {
    const listEl = document.getElementById('room-list');
    const noRoomsEl = document.getElementById('no-rooms-message');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (!rooms || rooms.length === 0) {
        if (noRoomsEl) noRoomsEl.style.display = 'block';
        return;
    }

    if (noRoomsEl) noRoomsEl.style.display = 'none';

    rooms.forEach(room => {
        const item = document.createElement('div');
        item.className = 'room-item';
        item.dataset.roomId = room.roomId;

        const isFull = room.currentPlayers >= room.maxPlayers;

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="color: ${isFull ? '#6b7280' : '#22c55e'}; font-size: 18px; font-weight: bold; margin-bottom: 5px;">房间 #${room.roomId}</div>
                    <div style="color: #9ca3af; font-size: 14px;">房主: ${room.ownerName || 'Unknown'} | 玩家: ${room.currentPlayers}/${room.maxPlayers}</div>
                </div>
                <button class="join-room-item-btn" ${isFull ? 'disabled' : ''} style="background: ${isFull ? '#4b5563' : '#22c55e'}; color: white; border: none; border-radius: 6px; padding: 8px 16px; font-size: 14px; cursor: ${isFull ? 'not-allowed' : 'pointer'}; transition: all 0.3s ease;">加入</button>
            </div>
        `;

        const btn = item.querySelector('.join-room-item-btn');
        if (btn && !isFull) {
            btn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    const joined = await colyseusClient.joinRoom({
                        roomId: room.roomId,
                        playerName: state.playerName || 'Player'
                    });
                    showNotification(`正在加入房间 #${joined.roomId}...`, 'info');
                    startMultiplayerFromRoom(joined.roomId);
                } catch (err) {
                    console.error('joinRoom failed', err);
                    showNotification('加入房间失败', 'error');
                }
            };
        }

        listEl.appendChild(item);
    });
}

function renderStashGrid() {
    const container = document.getElementById('stash-grid');
    if (!container) return;
    
    container.innerHTML = '';
    
    const items = state.stash.getFilteredItems();
    
    items.forEach(item => {
        const card = createItemCard(item);
        container.appendChild(card);
    });
    
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-stash">No items found</div>';
    }
}

function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.itemId = item.id;
    card.dataset.type = item.type; // 添加 data-type 用于高亮提示
    card.draggable = true;
    
    // 稀有度边框
    card.style.borderLeftColor = item.rarity.color;

    // 按稀有度添加类名，便于在 CSS 中控制不同颜色的 hover 发光效果
    if (item.rarity && item.rarity.name) {
        const rarityClass = `rarity-${item.rarity.name.toLowerCase()}`;
        card.classList.add(rarityClass);
    }
    
    // 耐久度条
    const durabilityPercent = (item.durability / item.maxDurability) * 100;
    let durabilityClass = 'durability-high';
    if (durabilityPercent < 30) durabilityClass = 'durability-low';
    else if (durabilityPercent < 60) durabilityClass = 'durability-medium';
    
    // 购买列表中的弹药显示中文名，其他物品显示全名
    const displayName = item.type === ITEM_TYPE.AMMO_GRADE ? item.name : item.name;
    
    card.innerHTML = `
        <div class="item-icon">${item.icon}</div>
        <div class="item-info">
            <div class="item-name" style="color: ${item.rarity.color}">${displayName}</div>
            <div class="item-meta">
                <span class="item-weight">⚖️ ${item.weight}kg</span>
                <span class="item-value">💰 ${item.value}</span>
            </div>
            <div class="item-durability ${durabilityClass}">
                <div class="durability-bar" style="width: ${durabilityPercent}%"></div>
            </div>
        </div>
        <div class="item-actions">
            <!-- 移除了 EQUIP 和 INFO 按钮，改为单击查看详情 -->
        </div>
    `;
    
    // 拖拽事件
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('itemId', item.id);
        card.classList.add('dragging');
    });
    
    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
    });
    
    // 悬停显示详情
    card.addEventListener('mouseenter', () => {
        showItemDetails(item);
    });

    // 点击直接装备
    card.addEventListener('click', () => {
        equipItemFromStash(item.id);
    });
    
    return card;
}

function renderEquipmentSlots() {
    const EQUIP_SLOT_INFO = [
        { id: EQUIP_SLOT.PRIMARY, label: '主武器', icon: '🔫' },
        { id: EQUIP_SLOT.AMMO_GRADE, label: '弹药', icon: '📦' },
        { id: EQUIP_SLOT.ARMOR, label: '护甲', icon: '🛡️' },
        { id: EQUIP_SLOT.BACKPACK, label: '背包', icon: '🎒' }
    ];
    
    EQUIP_SLOT_INFO.forEach(slot => {
        const slotEl = document.getElementById(`equip-slot-${slot.id}`);
        if (!slotEl) return;
        
        const item = state.stash.equipped[slot.id];
        
        // 智能检查：防止不必要的重绘导致动画重播
        const currentEquippedEl = slotEl.querySelector('.equipped-item');
        const currentEmptyEl = slotEl.querySelector('.empty-slot');
        
        // 如果物品ID相同，完全跳过
        if (item && currentEquippedEl && currentEquippedEl.dataset.itemId === item.id) {
            return;
        }
        // 如果都是空状态，完全跳过
        if (!item && currentEmptyEl) {
            return;
        }
        
        // 清除所有动态样式类
        slotEl.classList.remove(
            'equip-slot-weapon', 'equip-slot-armor', 'equip-slot-backpack', 'equip-slot-ammo',
            'equip-slot-common', 'equip-slot-uncommon', 'equip-slot-rare', 'equip-slot-legendary'
        );
        
        if (item) {
            // 根据物品稀有度设置槽位样式
            const rarityColorClass = `equip-slot-${item.rarity.name.toLowerCase()}`;
            slotEl.classList.add(rarityColorClass);
            
            slotEl.innerHTML = `
                <div class="equipped-item" data-item-id="${item.id}">
                    <div class="equipped-icon">${item.icon}</div>
                    <div class="equipped-name" style="color: ${item.rarity.color}">${item.name}</div>
                    <button class="unequip-btn" data-slot="${slot.id}">卸下</button>
                </div>
            `;
            
            const equippedEl = slotEl.querySelector('.equipped-item');
            const unequipBtn = slotEl.querySelector('.unequip-btn');

            // 左键单击已装备物品，显示详情
            if (equippedEl) {
                equippedEl.addEventListener('click', () => {
                    showItemDetails(item);
                });
                
                // 鼠标悬停显示详情
                equippedEl.addEventListener('mouseenter', () => {
                    showItemDetails(item);
                });
            }

            // 点击卸下按钮时，仅执行卸下，不触发详情点击
            if (unequipBtn) {
                unequipBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    unequipItem(slot.id);
                });
            }
        } else {
            slotEl.innerHTML = `
                <div class="empty-slot">
                    <div class="slot-icon">${slot.icon}</div>
                    <div class="slot-label">${slot.label}</div>
                </div>
            `;
        }
        
        // 拖放目标
        slotEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            slotEl.classList.add('drag-over');
        });
        
        slotEl.addEventListener('dragleave', () => {
            slotEl.classList.remove('drag-over');
        });
        
        slotEl.addEventListener('drop', (e) => {
            e.preventDefault();
            slotEl.classList.remove('drag-over');
            const itemId = e.dataTransfer.getData('itemId');
            const item = state.stash.getItem(itemId);
            if (item && item.slot === slot.id) {
                equipItemFromStash(itemId);
            }
        });
    });
}

async function equipItemFromStash(itemId) {
    const item = state.stash.getItem(itemId);
    if (!item) return;
    
    const slot = item.slot;
    
    // 检查费用（武器和弹药）
    if ((item.type === ITEM_TYPE.WEAPON || item.type === ITEM_TYPE.AMMO_GRADE) && item.value > 0) {
        if (state.currency < item.value) {
            showNotification(`无法装备 - 需要 ${item.value}，拥有 ${state.currency}`, 'error');
            return;
        }
    }
    
    console.log('🎯 装备物品前:', { 
    itemName: item.name, 
    itemWeight: item.weight,
    currentEquippedWeight: state.stash.getEquippedWeight().toFixed(1),
    equippedItems: Object.values(state.stash.equipped).filter(item => item !== null).map(item => item.name)
    });
    
    state.stash.equipItem(itemId, slot);
    
    // 如果是主武器，更新武器配置和重建模型
    if (slot === EQUIP_SLOT.PRIMARY && item.weaponConfig) {
        state.weaponConfig = item.weaponConfig;
        state.currentWeaponId = item.weaponConfig.id;
        if (state.camera && state.scene) {
            buildWeapon();
        }
    }
    
    // 如果是弹药等级，设置到全局状态
    if (slot === EQUIP_SLOT.AMMO_GRADE && item.ammoGrade) {
        state.currentAmmoGrade = item.ammoGrade;
    }
    
    console.log('✅ 装备物品后:', { 
        itemName: item.name, 
        newEquippedWeight: state.stash.getEquippedWeight().toFixed(1),
        equippedItems: Object.values(state.stash.equipped).filter(item => item !== null).map(item => item.name)
    });
    
    renderStashUI();
    showNotification(`已装备 ${item.name}`, 'success');
    await playEquipSound(); // 播放装备音效
}

function unequipItem(slot) {
    console.log('🔓 卸装备前:', { 
        slot: slot,
        currentEquippedWeight: state.stash.getEquippedWeight().toFixed(1),
        equippedItems: Object.values(state.stash.equipped).filter(item => item !== null).map(item => item.name)
    });
    
    const item = state.stash.unequipItem(slot);
    if (item) {
        console.log('✅ 卸装备后:', { 
            itemName: item.name,
            newEquippedWeight: state.stash.getEquippedWeight().toFixed(1),
            equippedItems: Object.values(state.stash.equipped).filter(item => item !== null).map(item => item.name)
        });
        
        renderStashUI();
        showNotification(`已卸下 ${item.name}`, 'success');
    }
}

function showItemDetails(item) {
    const detailsPanel = document.getElementById('item-details-panel');
    if (!detailsPanel) return;
    
    // 构建四个核心数值位置
    const stats = [];
    
    if (item.type === ITEM_TYPE.WEAPON && item.weaponConfig) {
        // 武器：伤害倍率、射速、弹夹容量、总弹药
        stats.push({
            label: '伤害',
            value: `${item.weaponConfig.damageScale}`
        });
        stats.push({
            label: '射速',
            value: item.weaponConfig.rpm ? `${item.weaponConfig.rpm} RPM` : `${(1/item.weaponConfig.fireRate).toFixed(1)} RPM`
        });
        stats.push({
            label: '弹夹',
            value: `${item.weaponConfig.maxAmmo}`
        });
        
        // 根据射程结束衰减距离判断射程等级
        let rangeLabel = '中程';
        const endDrop = item.weaponConfig.damageEndDrop || 80; // 默认80
        if (endDrop <= 75) {
            rangeLabel = '近程';
        } else if (endDrop > 90) {
            rangeLabel = '远程';
        }
        
        stats.push({
            label: '射程',
            value: rangeLabel
        });
    } else if (item.type === ITEM_TYPE.BAG) {
        // 背包：重量加成、医疗包影响、护甲包影响、备用弹药
        let ammoBonus = 0;
        if (item.name === '小型背包') {
            ammoBonus = 30;
        } else if (item.name === '中型背包') {
            ammoBonus = 60;
        } else if (item.name === '大型背包') {
            ammoBonus = 100;
        }
        // 医疗/护甲容量：按背包类型固定
        let kitCapacity = 100;
        if (item.name === '小型背包') {
            kitCapacity = 90;
        } else if (item.name === '中型背包') {
            kitCapacity = 150;
        } else if (item.name === '大型背包') {
            kitCapacity = 180;
        }
        
        stats.push({
            label: '背包槽位',
            value: `+${item.weightBonus >= 100 ? 14 : (item.weightBonus >= 60 ? 10 : (item.weightBonus > 0 ? 4 : 0))}`,
            isPositive: true
        });
        stats.push({
            label: '医疗包',
            value: `+${kitCapacity}`,
            isPositive: true
        });
        stats.push({
            label: '护甲包',
            value: `+${kitCapacity}`,
            isPositive: true
        });
        stats.push({
            label: '备用弹药',
            value: `+${ammoBonus}`,
            isPositive: true
        });
    } else if (item.type === ITEM_TYPE.AMMO_GRADE && item.ammoGrade) {
        // 子弹：伤害倍率和后坐力
        const damageBonus = ((item.ammoGrade.damageMultiplier - 1) * 100).toFixed(0);
        const recoilBonus = ((item.ammoGrade.recoilMultiplier - 1) * 100).toFixed(0);
        const rangeBonus = ((item.ammoGrade.rangeMultiplier - 1) * 100).toFixed(0);
        
        stats.push({
            label: '伤害',
            value: `${damageBonus >= 0 ? '+' : ''}${damageBonus}%`,
            isPositive: damageBonus >= 0
        });
        stats.push({
            label: '后坐力',
            value: `${recoilBonus >= 0 ? '+' : ''}${recoilBonus}%`,
            isPositive: recoilBonus < 0  // 后坐力减少是增益
        });
        stats.push({
            label: '射程',
            value: `${rangeBonus >= 0 ? '+' : ''}${rangeBonus}%`,
            isPositive: rangeBonus >= 0
        });
        // 空出其余位置
        stats.push({ label: '', value: '' });
    } else if (item.type === ITEM_TYPE.ARMOR) {
        // 护甲：护甲加成（暂只显示一个）
        stats.push({
            label: '护甲值',
            value: `+${item.armorValue || 0}`,
            isPositive: true
        });
        // 空出其余位置
        stats.push({ label: '', value: '' });
        stats.push({ label: '', value: '' });
        stats.push({ label: '', value: '' });
    }
    
    // 生成四个数值位置的HTML
    const statsHTML = stats.map(stat => `
        <div class="core-stat ${stat.value ? '' : 'empty'}">
            <div class="core-stat-label">${stat.label}</div>
            <div class="core-stat-value ${stat.isPositive === true ? 'stat-buff' : stat.isPositive === false ? 'stat-debuff' : ''}">${stat.value}</div>
        </div>
    `).join('');
    
    detailsPanel.innerHTML = `
        <div class="details-header" style="border-left: 4px solid ${item.rarity.color}">
            <div>
                <div class="details-name" style="color: ${item.rarity.color}">${item.name}</div>
                <div class="details-rarity" style="color: ${item.rarity.color}">${item.rarity.displayName || item.rarity.name}</div>
            </div>
        </div>
        <div class="details-description">${item.description}</div>
        <div class="core-stats-grid">
            ${statsHTML}
        </div>
    `;
    
    detailsPanel.style.display = 'block';
}

function updateStashStats() {
    const weightEl = document.getElementById('total-weight');
    const weightBonusEl = document.getElementById('weight-bonus');
    const currencyEl = document.getElementById('currency-val');
    const equipmentCostEl = document.getElementById('equipment-cost');
    
    // 不再在仓库界面显示负重和负重加成
    if (weightEl) {
        weightEl.textContent = '';
    }
    if (weightBonusEl) {
        weightBonusEl.style.display = 'none';
        weightBonusEl.textContent = '';
    }
    
    // 计算当前装备总花费
    let totalCost = 0;
    
    // 统一按照物品的 value 计算成本
    const primary = state.stash.equipped[EQUIP_SLOT.PRIMARY];
    if (primary) totalCost += primary.value || 0;
    
    const armor = state.stash.equipped[EQUIP_SLOT.ARMOR];
    if (armor) totalCost += armor.value || 0;
    
    const backpack = state.stash.equipped[EQUIP_SLOT.BACKPACK];
    if (backpack) totalCost += backpack.value || 0;
    
    const ammoGrade = state.stash.equipped[EQUIP_SLOT.AMMO_GRADE];
    if (ammoGrade) totalCost += ammoGrade.value || 0;
    
    if (equipmentCostEl) {
        // 显示花费（如果有花费的话）
        if (totalCost > 0) {
            equipmentCostEl.textContent = `-${totalCost}`;
            equipmentCostEl.style.display = 'block';
        } else {
            equipmentCostEl.style.display = 'none';
        }
    }
    
    if (currencyEl) {
        // 目标值 = 当前拥有的钱 - 预计花费
        const targetValue = state.currency - totalCost;
        
        // 获取当前显示的数值作为动画起点
        let currentValue = parseInt(currencyEl.textContent);
        if (isNaN(currentValue)) currentValue = state.currency;
        
        // 如果数值有变化，执行动画
        if (currentValue !== targetValue) {
            animateNumber(currencyEl, currentValue, targetValue, 400);
        } else {
            currencyEl.textContent = targetValue;
        }
    }
}

// 生成进度条HTML - 全新设计
function createStatBar(percentage, colorClass = 'stat-bar-high') {
    let barColor = colorClass;
    if (percentage <= 25) barColor = 'stat-bar-low';
    else if (percentage <= 50) barColor = 'stat-bar-medium';
    else if (percentage <= 75) barColor = 'stat-bar-high';
    else barColor = 'stat-bar-legendary';
    
    const clampedPercentage = Math.min(100, Math.max(0, percentage));
    
    return `
        <div class="stat-bar-container">
            <div class="stat-bar ${barColor}" style="width: ${clampedPercentage}%"></div>
        </div>
    `;
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    const container = document.getElementById('notification-container') || document.body;
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

export function initStashUIEvents() {
    // 类型过滤
    const typeFilters = document.querySelectorAll('.type-filter-btn');
    typeFilters.forEach(btn => {
        btn.addEventListener('click', () => {
            typeFilters.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filterType = btn.dataset.type;
            state.stash.filters.type = filterType === 'all' ? 'all' : filterType === 'ammoGrade' ? ITEM_TYPE.AMMO_GRADE : filterType;
            renderStashGrid();
        });
    });
    
    // 排序
    const sortBtn = document.getElementById('sort-select');
    if (sortBtn) {
        sortBtn.addEventListener('change', (e) => {
            state.stash.sortBy = e.target.value;
            renderStashGrid();
        });
    }
    
    // 搜索
    const searchInput = document.getElementById('stash-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.stash.filters.search = e.target.value;
            renderStashGrid();
        });
    }
    
    // 出击按钮
    const deployBtn = document.getElementById('deploy-btn');
    if (deployBtn) {
        deployBtn.addEventListener('click', handleDeploy);
    }

    // 清空 Loadout 按钮
    const clearLoadoutBtn = document.getElementById('clear-loadout-btn');
    if (clearLoadoutBtn) {
        clearLoadoutBtn.addEventListener('click', () => {
            const allSlots = [
                EQUIP_SLOT.PRIMARY,
                EQUIP_SLOT.AMMO_GRADE,
                EQUIP_SLOT.ARMOR,
                EQUIP_SLOT.BACKPACK
            ];
            allSlots.forEach(slot => {
                const item = state.stash.equipped[slot];
                if (item) {
                    unequipItem(slot);
                }
            });
            showNotification('装备已清空', 'info');
        });
    }

    // 玩家姓名不再点击改名，仅显示当前名称（改名入口移动到个人信息面板）
    const nameLabel = document.getElementById('player-name-label');
    if (nameLabel) {
        nameLabel.style.cursor = 'default';
        nameLabel.removeAttribute('title');
    }

    const renameConfirm = document.getElementById('rename-confirm');
    const renameCancel = document.getElementById('rename-cancel');

    if (renameConfirm) {
        renameConfirm.addEventListener('click', async () => {
            const input = document.getElementById('rename-input');
            const overlay = document.getElementById('rename-overlay');
            const label = document.getElementById('player-name-label');
            const btn = renameConfirm;
            if (!input) return;
            // 基础清洗：合并多余空格并去掉首尾空格
            const raw = input.value || '';
            const cleaned = raw.replace(/\s+/g, ' ').trim();
            if (!cleaned) {
                showNotification('名字不能为空', 'error');
                return;
            }
            // 仅允许：中文字符、英文、数字、下划线和减号（不允许空格）
            const validPattern = /^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/;
            if (!validPattern.test(cleaned)) {
                showNotification('名字包含无效字符', 'error');
                return;
            }

            if (cleaned === 'Player') {
                showNotification('名字不能是 Player', 'error');
                return;
            }

            const newName = cleaned.slice(0, 20);
            try {
                // 显示 Saving... 状态并禁用按钮，避免重复提交
                const originalText = btn.textContent;
                btn.textContent = 'Saving...';
                btn.disabled = true;

                await updateNickname(newName);
                state.playerName = newName;
                if (label) label.textContent = newName;
                showNotification(`名字已更新为 ${newName}`, 'success');
                if (overlay) overlay.style.display = 'none';
            } catch (e) {
                console.error('Failed to update nickname', e);
                showNotification('更新名字失败', 'error');
            } finally {
                // 恢复按钮状态
                btn.textContent = 'CONFIRM';
                btn.disabled = false;
            }
        });
    }

    if (renameCancel) {
        renameCancel.addEventListener('click', () => {
            const overlay = document.getElementById('rename-overlay');
            if (overlay) overlay.style.display = 'none';
        });
    }

    // 地图选择器逻辑
    const mapBtn = document.getElementById('map-selector-btn');
    const mapMenu = document.getElementById('map-selection-menu');
    const mapOptions = document.querySelectorAll('.map-option');

    if (mapBtn && mapMenu) {
        // 拦截菜单的所有鼠标事件，防止穿透到下方 UI
        ['mousedown', 'mouseup', 'click'].forEach(evt => {
            mapMenu.addEventListener(evt, (e) => {
                e.stopPropagation();
            });
        });

        // 切换菜单
        mapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mapMenu.classList.toggle('active');
        });

        // 选择地图
        mapOptions.forEach(opt => {
            opt.addEventListener('click', (e) => {
                // e.stopPropagation(); // 上面的容器拦截已经处理了冒泡，这里只需要处理业务逻辑
                
                // 移除其他选项的选中状态
                mapOptions.forEach(o => o.classList.remove('selected'));
                // 选中当前
                opt.classList.add('selected');
                
                // 检查是否为联机模式
                if (opt.dataset.mode === 'multiplayer') {
                    // 联机模式不设置难度，但应用视觉主题
                    console.log('⚠️ Selected multiplayer mode');
                    
                    // 更新按钮三角颜色
                    mapBtn.classList.remove('difficulty-normal', 'difficulty-hard', 'difficulty-insane', 'difficulty-challenge');
                    mapBtn.classList.add('difficulty-multiplayer');

                    // 更新整个 Stash 界面的主题
                    const stashOverlay = document.getElementById('stash-overlay');
                    if (stashOverlay) {
                        stashOverlay.classList.remove('theme-normal', 'theme-hard', 'theme-insane', 'theme-challenge');
                        stashOverlay.classList.add('theme-multiplayer');
                    }
                    
                    // 关闭菜单
                    mapMenu.classList.remove('active');
                    showNotification(`模式: ${opt.querySelector('.map-name').textContent}`, 'info');
                    return;
                }
                
                // 记录选中的难度（普通模式逻辑）
                state.selectedDifficulty = opt.dataset.difficulty;
                console.log('⚠️ Selected difficulty:', state.selectedDifficulty);
                
                // 更新按钮三角颜色
                mapBtn.classList.remove('difficulty-normal', 'difficulty-hard', 'difficulty-insane', 'difficulty-multiplayer', 'difficulty-challenge');
                mapBtn.classList.add(`difficulty-${state.selectedDifficulty}`);

                // 更新整个 Stash 界面的主题
                const stashOverlay = document.getElementById('stash-overlay');
                if (stashOverlay) {
                    stashOverlay.classList.remove('theme-normal', 'theme-hard', 'theme-insane', 'theme-multiplayer', 'theme-challenge');
                    stashOverlay.classList.add(`theme-${state.selectedDifficulty}`);
                }
                
                // 关闭菜单
                mapMenu.classList.remove('active');
                showNotification(`难度: ${opt.querySelector('.map-name').textContent}`, 'info');
            });
        });

        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (!mapMenu.contains(e.target) && !mapBtn.contains(e.target)) {
                mapMenu.classList.remove('active');
            }
        });
        
        // 初始化：设置默认选中的难度到 state，并更新按钮颜色
        const defaultSelected = document.querySelector('.map-option.selected');
        if (defaultSelected) {
            state.selectedDifficulty = defaultSelected.dataset.difficulty;
            mapBtn.classList.add(`difficulty-${state.selectedDifficulty}`);
            
            // 初始化主题
            const stashOverlay = document.getElementById('stash-overlay');
            if (stashOverlay) {
                stashOverlay.classList.add(`theme-${state.selectedDifficulty}`);
            }
        }
    }
}

function handleDeploy() {
    const check = state.stash.canDeploy();
    
    if (!check.canDeploy) {
            const issuesEl = document.getElementById('deploy-issues');
            if (issuesEl) {
                // 不再在右下角展示详细 issue 列表，保持区域隐藏
                issuesEl.innerHTML = '';
                issuesEl.style.display = 'none';
            }

            const hasNoPrimary = check.issues.includes('No primary weapon equipped');
            const hasNoAmmoGrade = check.issues.includes('No ammo grade selected');

            if (hasNoPrimary || hasNoAmmoGrade) {
                const parts = [];
                if (hasNoPrimary) parts.push('缺少武器');
                if (hasNoAmmoGrade) parts.push('缺少弹药');
                showNotification('无法部署 - ' + parts.join(', '), 'error');

                // 高亮提示对应类别
                const toHighlight = [];
                if (hasNoPrimary) toHighlight.push('weapon');
                if (hasNoAmmoGrade) toHighlight.push('ammoGrade');

                toHighlight.forEach(type => {
                    const cards = document.querySelectorAll(`.item-card[data-type="${type}"]`);
                    cards.forEach(card => card.classList.add('highlight-hint'));
                });

                // 3 秒后移除高亮
                setTimeout(() => {
                    document.querySelectorAll('.highlight-hint').forEach(card => {
                        card.classList.remove('highlight-hint');
                    });
                }, 3000);
            } else {
                showNotification('无法部署 - 请检查装备', 'error');
            }
            return;
        }

    // 计算当前loadout总消费
    let totalCost = 0;
    const primary = state.stash.equipped[EQUIP_SLOT.PRIMARY];
    const armor = state.stash.equipped[EQUIP_SLOT.ARMOR];
    const backpack = state.stash.equipped[EQUIP_SLOT.BACKPACK];
    const ammoGrade = state.stash.equipped[EQUIP_SLOT.AMMO_GRADE];

    if (primary) totalCost += primary.value || 0;
    if (armor) totalCost += armor.value || 0;
    if (backpack) totalCost += backpack.value || 0;
    if (ammoGrade) totalCost += ammoGrade.value || 0;

    // 检查战备要求
    const selectedMapOption = document.querySelector('.map-option.selected');
    const isMultiplayer = !!(selectedMapOption && selectedMapOption.dataset.mode === 'multiplayer');

    // PVE 难度战备要求（联机模式忽略难度门槛，只看本次装备花费）
    const difficulty = state.selectedDifficulty || 'normal';
    let requiredCost = 0;
    let difficultyName = '';
    
    if (!isMultiplayer) {
        if (difficulty === 'hard') {
            requiredCost = 1500;
            difficultyName = '困难';
        } else if (difficulty === 'insane') {
            requiredCost = 4000;
            difficultyName = '疯狂';
        }
    }
    
    // 如果有难度要求，检查是否满足
    if (requiredCost > 0 && totalCost < requiredCost) {
        showNotification(`该模式需要装备价值至少${requiredCost}信用点`, 'error');
        return;
    }

    // 标记玩家已经玩过游戏（成功deploy时）
    if (isFirstTimePlayer()) {
        markPlayerHasPlayed();
        // 移除光晕效果
        const deployBtn = document.getElementById('deploy-btn');
        if (deployBtn) {
            deployBtn.classList.remove('hint-glow');
        }
    }

    // 统一在 DEPLOY 阶段根据 value 一次性结算所有已装备物品的费用
    // totalCost 已在前面计算过

    // 根据当前选择的地图模式设置 gameMode：
    // - 普通模式：'pve'（使用 buildLevel 构建城市关卡）
    // - 联机模式：在 startMultiplayerFromRoom 中设为 'mp_arena'（这里不覆盖）
    if (!isMultiplayer) {
        state.gameMode = 'pve';
    }

    if (totalCost > 0) {
        if (state.currency < totalCost) {
            showNotification(`无法部署 - 需要 ${totalCost}，拥有 ${state.currency}`, 'error');
            return;
        }

        // 先扣除货币
        state.currency -= totalCost;
        
        // 安全同步：先服务器后本地
        updateCurrency(state.currency)
            .then(() => {
                console.log('✅ 部署费用已同步到服务器');
                // 服务器同步成功后，保存本地备份
                saveCurrency(state.currency);
                // 清除待同步标记
                localStorage.removeItem('currency_pending_sync');
            })
            .catch((error) => {
                console.warn('⚠️ 部署费用同步失败，保存本地备份:', error);
                // 失败时保存本地备份
                saveCurrency(state.currency);
                // 标记需要同步
                localStorage.setItem('currency_pending_sync', 'true');
                showNotification('网络异常，数据将在恢复后同步', 'warning');
            });

        const curEl = document.getElementById('currency-val');
        if (curEl) curEl.textContent = state.currency;

        showNotification(`已部署 (-${totalCost} 信用点)`, 'success');
    }

    // 部署检查和扣费通过后，根据当前选择的模式决定后续流程
    if (selectedMapOption && selectedMapOption.dataset.mode === 'multiplayer') {
        // 联机模式：不立刻开始游戏，进入房间选择界面
        showRoomSelection();
        return;
    }

    // 普通 PVE 模式：显示部署缓冲界面并直接启动游戏
    const deployLoadingOverlay = document.getElementById('deploy-loading-overlay');
    if (deployLoadingOverlay) {
        deployLoadingOverlay.style.display = 'flex';
    }
    
    const stashOverlay = document.getElementById('stash-overlay');
    if (stashOverlay) stashOverlay.style.display = 'none';
    
    if (window.startGameFromStash) {
        window.startGameFromStash();
    }
}

function animateNumber(element, start, end, duration, formatter = Math.floor) {
    let startTime = null;
    
    function animation(currentTime) {
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const progress = Math.min(timeElapsed / duration, 1);
        
        // easeOutQuart 缓动函数
        const ease = 1 - Math.pow(1 - progress, 4);
        
        const current = start + (end - start) * ease;
        element.textContent = formatter(current);
        
        if (timeElapsed < duration) {
            requestAnimationFrame(animation);
        } else {
            element.textContent = formatter(end);
        }
    }
    
    requestAnimationFrame(animation);
}

// 房间选择界面相关函数
function showRoomSelection() {
    const roomOverlay = document.getElementById('room-selection-overlay');
    if (roomOverlay) {
        roomOverlay.style.display = 'block';

        // 初始化本地 Photon 客户端并绑定房间列表更新
        colyseusClient.reset();
        colyseusClient.init({ userId: state.playerName || 'Player' });
        colyseusClient.setRoomListUpdateHandler((rooms) => {
            renderRoomList(rooms);
        });

        initRoomSelectionEvents();
        // 初次打开时异步获取一次房间列表（当前实现会返回空列表，占位用）
        (async () => {
            try {
                const rooms = await colyseusClient.getRoomList();
                renderRoomList(rooms);
            } catch (e) {
                console.error('getRoomList failed', e);
                renderRoomList([]);
            }
        })();
    }
}

function hideRoomSelection() {
    const roomOverlay = document.getElementById('room-selection-overlay');
    if (roomOverlay) {
        roomOverlay.style.display = 'none';
    }
}

// 启动本地联机训练场（仍然复用仓库配置和扣费结果）
function startMultiplayerFromRoom(roomId) {
    state.gameMode = 'mp_arena';
    state.mp.roomId = roomId || 'local-demo-room';
    // 使用玩家在游戏中的昵称作为联机唯一标识
    const selfId = state.playerName || colyseusClient.userId || state.mp.playerId || 'local-player';
    state.mp.playerId = selfId;
    // 从 Photon 模拟客户端获取当前房间成员，构建联机玩家列表
    const members = colyseusClient.getRoomPlayers(state.mp.roomId) || [];

    console.log('[MP] startMultiplayerFromRoom: roomId =', state.mp.roomId, 'selfId =', selfId);
    console.log('[MP] Photon room members =', members);

    // 注意：这里使用 m.name 作为 id，与我们在 sendLocalPlayerState 中发送的 playerId 保持一致
    state.mp.players = members.map(m => ({
        id: m.name,
        name: m.name,
        team: 'ally',
        isLocal: m.name === selfId,
        isBot: false
    }));

    console.log('[MP] Built state.mp.players =', state.mp.players);

    // 如果没有其他队友，补一个本地假队友
    if (state.mp.players.length <= 1) {
        state.mp.players.push({
            id: 'ally-bot-1',
            name: '队友A',
            team: 'ally',
            isLocal: false,
            isBot: true
        });
    }

    // 补一个敌方 Bot 作为占位
    state.mp.players.push({
        id: 'enemy-bot-1',
        name: '对手X',
        team: 'enemy',
        isLocal: false,
        isBot: true
    });

    hideRoomSelection();

    // 显示部署缓冲界面并隐藏仓库，然后真正开始游戏
    const deployLoadingOverlay = document.getElementById('deploy-loading-overlay');
    if (deployLoadingOverlay) {
        deployLoadingOverlay.style.display = 'flex';
    }

    const stashOverlay = document.getElementById('stash-overlay');
    if (stashOverlay) stashOverlay.style.display = 'none';

    if (window.startGameFromStash) {
        window.startGameFromStash();
    }
}

function initRoomSelectionEvents() {
    // 创建房间按钮
    const createRoomBtn = document.getElementById('create-room-btn');
    if (createRoomBtn) {
        createRoomBtn.onclick = async () => {
            try {
                const room = await colyseusClient.createRoom({
                    ownerName: state.playerName || 'Player',
                    playerName: state.playerName || 'Player'
                });
                showNotification(`已创建房间 #${room.roomId}`, 'success');
                startMultiplayerFromRoom(room.roomId);
            } catch (err) {
                console.error('createRoom failed', err);
                showNotification('创建房间失败', 'error');
            }
        };
    }

    // 房间号加入按钮
    const joinRoomCodeBtn = document.getElementById('join-room-code-btn');
    if (joinRoomCodeBtn) {
        joinRoomCodeBtn.onclick = async () => {
            const code = window.prompt('输入房间号');
            if (!code) return;
            try {
                const room = await colyseusClient.joinRoom({
                    roomId: code.trim(),
                    playerName: state.playerName || 'Player'
                });
                showNotification(`正在加入房间 #${room.roomId}...`, 'info');
                startMultiplayerFromRoom(room.roomId);
            } catch (err) {
                console.error('joinRoom by code failed', err);
                showNotification('加入房间失败，检查房间号是否正确', 'error');
            }
        };
    }

    // 返回仓库按钮
    const backToStashBtn = document.getElementById('back-to-stash-btn');
    if (backToStashBtn) {
        backToStashBtn.onclick = () => {
            hideRoomSelection();
        };
    }

    // 房间列表中的加入按钮
    const joinRoomItemBtns = document.querySelectorAll('.join-room-item-btn');
    joinRoomItemBtns.forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const roomItem = btn.closest('.room-item');
            const roomNameEl = roomItem.querySelector('div > div');
            const roomName = roomNameEl ? roomNameEl.textContent : '房间';
            showNotification(`正在加入 ${roomName}...`, 'info');
            startMultiplayerFromRoom(roomName);
        };
    });

    // 房间项悬停效果
    const roomItems = document.querySelectorAll('.room-item');
    roomItems.forEach(item => {
        item.addEventListener('mouseenter', () => {
            item.style.transform = 'translateY(-2px)';
            item.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
        });
        
        item.addEventListener('mouseleave', () => {
            item.style.transform = 'translateY(0)';
            item.style.boxShadow = 'none';
        });
    });

    // 底部按钮悬停效果
    const roomBtns = document.querySelectorAll('.room-btn');
    roomBtns.forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'translateY(-2px) scale(1.05)';
            btn.style.boxShadow = btn.id === 'create-room-btn' ? 
                '0 6px 20px rgba(34, 197, 94, 0.4)' : 
                '0 6px 20px rgba(59, 130, 246, 0.4)';
        });
        
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(0) scale(1)';
            btn.style.boxShadow = btn.id === 'create-room-btn' ? 
                '0 4px 15px rgba(34, 197, 94, 0.3)' : 
                '0 4px 15px rgba(59, 130, 246, 0.3)';
        });
    });
}
