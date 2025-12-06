import { state } from './globals.js';
import { CONFIG, AMMO_GRADES } from './config.js';

// 物品稀有度
export const RARITY = {
    COMMON: { name: 'Common', displayName: '普通', color: '#9ca3af', value: 1 },
    UNCOMMON: { name: 'Uncommon', displayName: '稀有', color: '#3b82f6', value: 2 },
    RARE: { name: 'Rare', displayName: '史诗', color: '#8b5cf6', value: 3 },
    LEGENDARY: { name: 'Legendary', displayName: '传奇', color: '#eab308', value: 4 }
};

// 物品类型
export const ITEM_TYPE = {
    WEAPON: 'weapon',
    ARMOR: 'armor',
    BAG: 'bag',
    AMMO: 'ammo',
    AMMO_GRADE: 'ammoGrade',
    CONSUMABLE: 'consumable',
    MISC: 'misc'
};

// 装备槽位
export const EQUIP_SLOT = {
    PRIMARY: 'primary',
    ARMOR: 'armor',
    BACKPACK: 'backpack',
    AMMO_GRADE: 'ammoGrade'
};

// 物品类定义
export class Item {
    constructor(data) {
        this.id = data.id || `item_${Date.now()}_${Math.random()}`;
        this.type = data.type;
        this.name = data.name;
        this.rarity = data.rarity || RARITY.COMMON;
        this.weight = data.weight || 1;
        this.value = data.value || 0;
        this.durability = data.durability !== undefined ? data.durability : 100;
        this.maxDurability = data.maxDurability || 100;
        this.icon = data.icon || '📦';
        this.description = data.description || '';
        this.tags = data.tags || [];
        
        // 武器特有属性
        if (this.type === ITEM_TYPE.WEAPON) {
            this.weaponConfig = data.weaponConfig;
            this.slot = data.slot || EQUIP_SLOT.PRIMARY;
        }
        
        // 护甲特有属性
        if (this.type === ITEM_TYPE.ARMOR) {
            this.armorValue = data.armorValue || 0;
            this.maxArmorCapacity = data.maxArmorCapacity || data.armorValue || 0;
            this.slot = data.slot;
        }
        
        // 背包特有属性
        if (this.type === ITEM_TYPE.BAG) {
            this.weightBonus = data.weightBonus || 0;
            this.slot = data.slot || EQUIP_SLOT.BACKPACK;
        }
        
        // 兼容性：如果slot是BACKPACK，也设置weightBonus
        if (this.slot === EQUIP_SLOT.BACKPACK) {
            this.weightBonus = data.weightBonus || 0;
        }
        
        // 弹药等级特有属性
        if (this.type === ITEM_TYPE.AMMO_GRADE) {
            this.ammoGrade = data.ammoGrade;
            this.slot = EQUIP_SLOT.AMMO_GRADE;
        }
    }
}

// 仓库管理
export class Stash {
    constructor() {
        this.items = [];
        this.equipped = {
            [EQUIP_SLOT.PRIMARY]: null,
            [EQUIP_SLOT.ARMOR]: null,
            [EQUIP_SLOT.BACKPACK]: null,
            [EQUIP_SLOT.AMMO_GRADE]: null
        };
        this.filters = {
            type: 'all',
            rarity: 'all',
            search: ''
        };
        this.sortBy = 'name';
    }
    
    addItem(itemData) {
        const item = new Item(itemData);
        this.items.push(item);
        return item;
    }
    
    removeItem(itemId) {
        const index = this.items.findIndex(i => i.id === itemId);
        if (index > -1) {
            return this.items.splice(index, 1)[0];
        }
        return null;
    }
    
    getItem(itemId) {
        return this.items.find(i => i.id === itemId);
    }
    
    equipItem(itemId, slot) {
        const item = this.getItem(itemId);
        if (!item) return false;
        
        // 卸载当前装备
        if (this.equipped[slot]) {
            this.unequipItem(slot);
        }
        
        this.equipped[slot] = item;
        this.removeItem(itemId);
        return true;
    }
    
    unequipItem(slot) {
        const item = this.equipped[slot];
        if (item) {
            this.equipped[slot] = null;
            this.items.push(item);
        }
        return item;
    }
    
    getFilteredItems() {
        let filtered = [...this.items];
        
        // 类型过滤
        if (this.filters.type !== 'all') {
            filtered = filtered.filter(i => i.type === this.filters.type);
        }
        
        // 稀有度过滤
        if (this.filters.rarity !== 'all') {
            filtered = filtered.filter(i => i.rarity.name === this.filters.rarity);
        }
        
        // 搜索过滤
        if (this.filters.search) {
            const search = this.filters.search.toLowerCase();
            filtered = filtered.filter(i => 
                i.name.toLowerCase().includes(search) ||
                i.description.toLowerCase().includes(search) ||
                i.tags.some(t => t.toLowerCase().includes(search))
            );
        }
        
        // 排序
        filtered.sort((a, b) => {
            // ALL 标签：按种类 -> 稀有度 -> 名称
            if (this.filters.type === 'all') {
                const typeOrder = {
                    [ITEM_TYPE.WEAPON]: 1,
                    [ITEM_TYPE.ARMOR]: 2,
                    [ITEM_TYPE.BAG]: 3,
                    [ITEM_TYPE.AMMO_GRADE]: 4,
                    [ITEM_TYPE.AMMO]: 5,
                    [ITEM_TYPE.CONSUMABLE]: 6,
                    [ITEM_TYPE.MISC]: 7
                };
                const ta = typeOrder[a.type] || 999;
                const tb = typeOrder[b.type] || 999;
                if (ta !== tb) return ta - tb; // 先按种类分组
                if (b.rarity.value !== a.rarity.value) return b.rarity.value - a.rarity.value; // 同种类按稀有度
                return a.name.localeCompare(b.name); // 再按名字
            }

            // 其它标签：保持原有 sortBy 行为
            switch(this.sortBy) {
                case 'name': return a.name.localeCompare(b.name);
                case 'rarity': return b.rarity.value - a.rarity.value;
                case 'weight': return a.weight - b.weight;
                case 'value': return b.value - a.value;
                default: return 0;
            }
        });
        
        return filtered;
    }
    
    getTotalWeight() {
        const stashWeight = this.items.reduce((sum, item) => sum + item.weight, 0);
        const equippedWeight = Object.values(this.equipped)
            .filter(item => item !== null)
            .reduce((sum, item) => sum + item.weight, 0);
        return stashWeight + equippedWeight;
    }
    
    // 只获取装备重量（用于UI显示）
    getEquippedWeight() {
        const baseEquippedWeight = Object.values(this.equipped)
            .filter(item => item !== null)
            .reduce((sum, item) => sum + item.weight, 0);
        const scoreBonus = Math.floor(state.score / 100); // 每击杀（约100分）增加1重量
        return baseEquippedWeight + scoreBonus;
    }
    
    getMaxWeight() {
        const baseWeight = 50; // 初始kit和护甲只有50上限
        const backpack = this.equipped[EQUIP_SLOT.BACKPACK];
        const backpackBonus = backpack ? (backpack.weightBonus || 0) : 0;
        return baseWeight + backpackBonus; // 只由背包决定，不受积分影响
    }
    
    getArmorCapacity() {
        const armor = this.equipped[EQUIP_SLOT.ARMOR];
        return armor ? armor.maxArmorCapacity : 0;
    }
    
    canDeploy() {
        const issues = [];
        
        // 检查是否有主武器
        if (!this.equipped[EQUIP_SLOT.PRIMARY]) {
            issues.push('No primary weapon equipped');
        }
        
        // 检查是否选择弹药等级
        if (!this.equipped[EQUIP_SLOT.AMMO_GRADE]) {
            issues.push('No ammo grade selected');
        }
        
        // 检查主武器耐久
        const primary = this.equipped[EQUIP_SLOT.PRIMARY];
        if (primary && primary.durability / primary.maxDurability < 0.3) {
            issues.push('Primary weapon durability too low');
        }
        
        return {
            canDeploy: issues.length === 0,
            issues
        };
    }
}

// 初始化仓库并添加一些初始物品
export function initStash() {
    if (!state.stash) {
        state.stash = new Stash();
        
        // 添加初始武器
        state.stash.addItem({
            type: ITEM_TYPE.WEAPON,
            name: CONFIG.weaponPresets.m4a1.displayName,
            rarity: RARITY.COMMON,
            weight: 3.5,
            value: 0,
            durability: 100,
            maxDurability: 100,
            icon: '🔫',
            description: '美制卡宾枪，平衡的射速与精度，适合近距离作战。',
            weaponConfig: CONFIG.weaponPresets.m4a1,
            slot: EQUIP_SLOT.PRIMARY,
            tags: ['assault', 'automatic', '5.56']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.WEAPON,
            name: CONFIG.weaponPresets.mk14.displayName,
            rarity: RARITY.RARE,
            weight: 3.5,
            value: 1000,
            durability: 100,
            maxDurability: 100,
            icon: '🔫',
            description: '美制7.62mm步枪，改进瞄准具和护木，提升中远距离精度。',
            weaponConfig: CONFIG.weaponPresets.mk14,
            slot: EQUIP_SLOT.PRIMARY,
            tags: ['assault', 'semi-auto', '7.62']
        });

        state.stash.addItem({
            type: ITEM_TYPE.WEAPON,
            name: CONFIG.weaponPresets.hk416.displayName,
            rarity: RARITY.RARE,
            weight: 3.5,
            value: 1200,
            durability: 100,
            maxDurability: 100,
            icon: '🔫',
            description: 'AR-15深度改进型，短行程活塞系统，恶劣环境可靠性高。',
            weaponConfig: CONFIG.weaponPresets.hk416,
            slot: EQUIP_SLOT.PRIMARY,
            tags: ['assault', 'automatic', '5.56']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.WEAPON,
            name: CONFIG.weaponPresets.ak.displayName,
            rarity: RARITY.UNCOMMON,
            weight: 4.3,
            value: 400,
            durability: 100,
            maxDurability: 100,
            icon: '🔫',
            description: '苏制7.62mm突击步枪，结构坚固，极端气候可靠，停止作用强。',
            weaponConfig: CONFIG.weaponPresets.ak,
            slot: EQUIP_SLOT.PRIMARY,
            tags: ['assault', 'automatic', '7.62']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.WEAPON,
            name: CONFIG.weaponPresets.ash.displayName,
            rarity: RARITY.LEGENDARY,
            weight: 6.8,
            value: 1500,
            durability: 100,
            maxDurability: 100,
            icon: '🔫',
            description: '俄制大口径CQB步枪，发射亚音速弹药，专为摧毁重甲目标设计。',
            weaponConfig: CONFIG.weaponPresets.ash,
            slot: EQUIP_SLOT.PRIMARY,
            tags: ['cannon', 'heavy', 'experimental']
        });
        
        // 添加一些护甲
        state.stash.addItem({
            type: ITEM_TYPE.ARMOR,
            name: '轻型护甲',
            rarity: RARITY.UNCOMMON,
            weight: 6.0,
            value: 400,
            durability: 100,
            maxDurability: 100,
            icon: '🛡️',
            description: '轻型护甲。提供50点护甲值。',
            armorValue: 50,
            maxArmorCapacity: 50,
            slot: EQUIP_SLOT.ARMOR,
            tags: ['armor', 'light']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.ARMOR,
            name: '重型护甲',
            rarity: RARITY.RARE,
            weight: 12.0,
            value: 1000,
            durability: 100,
            maxDurability: 100,
            icon: '🛡️',
            description: '重型护甲。提供100点护甲值。',
            armorValue: 100,
            maxArmorCapacity: 100,
            slot: EQUIP_SLOT.ARMOR,
            tags: ['armor', 'heavy']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.BAG,
            name: '小型背包',
            rarity: RARITY.COMMON,
            weight: 1.5,
            value: 500,
            durability: 100,
            maxDurability: 100,
            icon: '🎒',
            description: '紧凑背包。背包槽位+4。',
            weightBonus: 30,
            slot: EQUIP_SLOT.BACKPACK,
            tags: ['backpack', 'storage']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.BAG,
            name: '中型背包',
            rarity: RARITY.UNCOMMON,
            weight: 2.0,
            value: 1200,
            durability: 100,
            maxDurability: 100,
            icon: '🎒',
            description: '标准背包。背包槽位+10。',
            weightBonus: 60,
            slot: EQUIP_SLOT.BACKPACK,
            tags: ['backpack', 'storage']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.BAG,
            name: '大型背包',
            rarity: RARITY.RARE,
            weight: 3.0,
            value: 1900,
            durability: 100,
            maxDurability: 100,
            icon: '🎒',
            description: '军用背包。背包槽位+14。',
            weightBonus: 100,
            slot: EQUIP_SLOT.BACKPACK,
            tags: ['backpack', 'storage', 'tactical']
        });
        
        // 添加三档弹药
        state.stash.addItem({
            type: ITEM_TYPE.AMMO_GRADE,
            name: '标准弹药',
            rarity: RARITY.COMMON,
            weight: 0.5,
            value: 0,
            durability: 100,
            maxDurability: 100,
            icon: '⚫', // 黑色圆圈对应普通品质
            description: '标准军用弹药，性能均衡，适用于各种战斗场景。',
            ammoGrade: AMMO_GRADES.standard,
            slot: EQUIP_SLOT.AMMO_GRADE,
            tags: ['ammo', 'standard']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.AMMO_GRADE,
            name: '穿甲弹药',
            rarity: RARITY.RARE,
            weight: 0.6,
            value: 1200,
            durability: 100,
            maxDurability: 100,
            icon: '🟣', // 紫色圆圈对应AP弹
            description: '穿甲弹（AP），专为穿透护甲设计，对装甲目标有显著效果。',
            ammoGrade: AMMO_GRADES.armor_piercing,
            slot: EQUIP_SLOT.AMMO_GRADE,
            tags: ['ammo', 'ap']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.AMMO_GRADE,
            name: '高爆弹药',
            rarity: RARITY.LEGENDARY,
            weight: 0.7,
            value: 2500,
            durability: 100,
            maxDurability: 100,
            icon: '🟠', // 橙色圆圈对应传奇品质
            description: '高爆弹（HE），内置爆炸物质，命中目标产生爆炸效果，威力巨大。',
            ammoGrade: AMMO_GRADES.high_explosive,
            slot: EQUIP_SLOT.AMMO_GRADE,
            tags: ['ammo', 'he']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.AMMO_GRADE,
            name: '全金属弹',
            rarity: RARITY.UNCOMMON,
            weight: 0.65,
            value: 500,
            durability: 100,
            maxDurability: 100,
            icon: '🔹', // 深蓝色小球对应FMJ弹
            description: '全金属被甲弹（FMJ），穿透力强，后坐力相对较小，精度较高。',
            ammoGrade: AMMO_GRADES.fmj,
            slot: EQUIP_SLOT.AMMO_GRADE,
            tags: ['ammo', 'fmj']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.AMMO_GRADE,
            name: '空尖弹',
            rarity: RARITY.RARE,
            weight: 0.55,
            value: 1200,
            durability: 100,
            maxDurability: 100,
            icon: '🟣', // 紫色圆圈对应稀有品质
            description: '空尖弹（HP），命中后扩张变形，造成更大创伤，但射程较近。',
            ammoGrade: AMMO_GRADES.hp,
            slot: EQUIP_SLOT.AMMO_GRADE,
            tags: ['ammo', 'hp']
        });
        
        state.stash.addItem({
            type: ITEM_TYPE.AMMO_GRADE,
            name: 'RIP弹',
            rarity: RARITY.UNCOMMON,
            weight: 0.6,
            value: 800,
            durability: 100,
            maxDurability: 100,
            icon: '🔹', // 深蓝色小球对应非普通品质
            description: 'RIP弹，极端侵入性能弹，伤害极高但射程大幅缩短，近距离致命。',
            ammoGrade: AMMO_GRADES.rip,
            slot: EQUIP_SLOT.AMMO_GRADE,
            tags: ['ammo', 'rip']
        });
        
        // 默认装备 M4A1 Carbine 和标准弹药
        const m4Item = state.stash.items.find(item => item.name === 'M4A1 Carbine');
        const standardAmmo = state.stash.items.find(item => item.name === '标准弹药');
        
        if (m4Item) {
            state.stash.equipItem(m4Item.id, EQUIP_SLOT.PRIMARY);
            console.log('🔫 默认装备M4A1步枪');
        }
        
        if (standardAmmo) {
            state.stash.equipItem(standardAmmo.id, EQUIP_SLOT.AMMO_GRADE);
            console.log('📦 默认装备标准弹药');
        }
    }
}
