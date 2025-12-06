import { updateCurrency } from './backend_client.js';

// 存储键名
const STORAGE_KEY = 'tacops_game_data';

// 检查是否是第一次玩
export function isFirstTimePlayer() {
    try {
        const data = loadGameData();
        return !data.hasPlayedBefore;
    } catch (e) {
        console.error('检查首次玩家失败:', e);
        return true; // 出错时默认认为是第一次
    }
}

// 标记玩家已经玩过
export function markPlayerHasPlayed() {
    try {
        const data = loadGameData();
        data.hasPlayedBefore = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log('✅ 玩家已标记为非首次');
    } catch (e) {
        console.error('标记玩家状态失败:', e);
    }
}

// 保存货币到localStorage
export function saveCurrency(currency) {
    try {
        const data = loadGameData();
        data.currency = currency;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log('💾 货币已保存:', currency);
    } catch (e) {
        console.error('保存货币失败:', e);
    }
}

// 加载货币从localStorage
export function loadCurrency() {
    try {
        const data = loadGameData();
        const currency = data.currency || 0;
        console.log('💰 加载货币:', currency);
        return currency;
    } catch (e) {
        console.error('加载货币失败:', e);
        return 0;
    }
}

// 加载所有游戏数据
function loadGameData() {
    try {
        const json = localStorage.getItem(STORAGE_KEY);
        return json ? JSON.parse(json) : {};
    } catch (e) {
        console.error('加载游戏数据失败:', e);
        return {};
    }
}

// 清空所有数据（用于调试）
export function clearGameData() {
    localStorage.removeItem(STORAGE_KEY);
    console.log('🗑️ 游戏数据已清空');
}

// 监听货币变化并自动保存（安全版本：服务器优先）
export function watchCurrency(state) {
    let lastCurrency = state.currency;
    
    // 每5秒检查一次货币变化（降低频率，减少服务器压力）
    setInterval(() => {
        if (state.currency !== lastCurrency) {
            console.log('💰 检测到货币变化，开始同步...');
            
            // 优先上传服务器，失败时才保存本地备份
            updateCurrency(state.currency)
                .then(() => {
                    console.log('✅ 货币已同步到服务器:', state.currency);
                    // 服务器同步成功后，保存本地备份
                    saveCurrency(state.currency);
                    // 清除待同步标记
                    localStorage.removeItem('currency_pending_sync');
                })
                .catch((error) => {
                    console.warn('⚠️ 服务器同步失败，使用本地备份:', error);
                    // 仅作为备份保存本地
                    saveCurrency(state.currency);
                    // 标记需要同步
                    localStorage.setItem('currency_pending_sync', 'true');
                });
            
            lastCurrency = state.currency;
        }
    }, 5000);
}
