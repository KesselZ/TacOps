import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Supabase 客户端
const supabase = createClient(
    'https://ydjtssdtvxdbstjkfpru.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkanRzc2R0dnhkYnN0amtmcHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyMzY0ODQsImV4cCI6MjA3OTgxMjQ4NH0.bGAV4QQa3w7CN9dISTOzk4rPaK79Rq-fhjAB7TL61FE'
);

// 生成或获取用户UUID
function getUserUUID() {
    let uuid = localStorage.getItem('tacops_user_id');
    if (!uuid) {
        uuid = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('tacops_user_id', uuid);
    }
    return uuid;
}

// 获取用户数据
export async function getUserData() {
    try {
        const uuid = getUserUUID();
        console.log('🔍 查询用户数据:', uuid);
        
        const { data, error } = await supabase
            .from('users')
            .select('credit, nickname, setting')
            .eq('uuid', uuid);
            
        if (error) {
            console.error('❌ Supabase 查询错误:', error);
            return { credit: 0, nickname: 'Player', setting: {} }; // 获取失败时返回0
        }
        
        console.log('📊 查询结果:', { dataLength: data?.length || 0, data });
        
        if (data && data.length > 0) {
            console.log('✅ 找到已存在用户:', data[0]);
            return data[0];
        } else {
            console.log('⚠️ 用户不存在，返回默认值');
            return { credit: 0, nickname: 'Player', setting: {} }; // 新用户初始为0
        }
    } catch (error) {
        console.error('❌ 获取用户数据失败:', error);
        return { credit: 0, nickname: 'Player', setting: {} }; // 异常时返回0
    }
}

// 获取用户数据（通过UUID）
export async function getUserDataByUUID(uuid) {
    try {
        console.log('🔍 查询用户数据（通过UUID）：', uuid);
        
        const { data, error } = await supabase
            .from('users')
            .select('credit, nickname, setting')
            .eq('uuid', uuid);
            
        if (error) {
            console.error('❌ Supabase 查询错误:', error);
            return null;
        }
        
        console.log('📊 查询结果:', { dataLength: data?.length || 0, data });
        
        if (data && data.length > 0) {
            console.log('✅ 找到已存在用户:', data[0]);
            return data[0];
        } else {
            console.log('⚠️ 用户不存在');
            return null;
        }
    } catch (error) {
        console.error('❌ 获取用户数据失败:', error);
        return null;
    }
}

// 创建新用户
async function createUser(uuid, credit = 2000, nickname = 'Player') {
    try {
        console.log('🔍 尝试创建用户:', { uuid, credit, nickname });
        
        // 添加北京时间戳
        const beijingTime = new Date();
        beijingTime.setHours(beijingTime.getHours() + 8);
        
        const { data, error } = await supabase
            .from('users')
            .insert({ 
                uuid, 
                credit, 
                nickname, 
                updated_at: beijingTime.toISOString(),
                setting: {}
            })
            .select('credit, nickname, setting')
            .single();
            
        if (error) {
            console.error('❌ Supabase 插入错误:', error);
            throw error;
        }
        
        console.log('✅ Supabase 插入成功，返回数据:', data);
        return data;
    } catch (error) {
        console.error('❌ 创建用户失败:', error);
        throw error;
    }
}

// 保存用户数据
export async function saveUserData(updates) {
    try {
        const uuid = getUserUUID();
        
        // 添加北京时间戳 (UTC+8)
        const beijingTime = new Date();
        beijingTime.setHours(beijingTime.getHours() + 8);
        
        const updatesWithTimestamp = {
            ...updates,
            updated_at: beijingTime.toISOString()
        };
        
        const { data, error } = await supabase
            .from('users')
            .update(updatesWithTimestamp)
            .eq('uuid', uuid)
            .select('credit, nickname, setting')
            .single();
            
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('保存用户数据失败:', error);
        throw error;
    }
}

// 初始化后端 - 完整版本，支持创建用户
export async function initBackend(localData = null) {
    try {
        console.log('🚀 初始化 Supabase 连接...');
        
        const uuid = getUserUUID();
        let userData = await getUserData();
        
        // 检查是否真的需要创建新用户
        // 只有当查询返回空数据时才创建用户
        const { data: existingCheck } = await supabase
            .from('users')
            .select('uuid')
            .eq('uuid', uuid);
            
        const userExists = existingCheck && existingCheck.length > 0;
        console.log('🔍 用户存在检查:', { uuid, userExists, dataLength: existingCheck?.length });
        
        if (!userExists) {
            console.log('👤 确认创建新用户:', uuid);
            try {
                userData = await createUser(uuid, 2000, 'Player'); // 新用户默认2000信用点
                console.log('✅ 用户创建成功:', userData);
            } catch (error) {
                console.error('❌ 用户创建失败:', error);
                // 如果创建失败，返回默认值
                return { credit: 0, nickname: 'Player' };
            }
        } else {
            console.log('✅ 用户已存在，跳过创建');
        }
        
        // 检查是否有待同步的本地数据
        const pendingSync = localStorage.getItem('currency_pending_sync');
        if (pendingSync === 'true') {
            console.log('🔄 检测到待同步数据，尝试同步...');
            try {
                const localData = JSON.parse(localStorage.getItem('tacops_game_data') || '{}');
                if (localData.currency && localData.currency > userData.credit) {
                    console.log('💰 同步本地货币到服务器:', localData.currency);
                    userData = await saveUserData({ credit: localData.currency });
                    localStorage.removeItem('currency_pending_sync');
                    console.log('✅ 待同步数据已处理');
                }
            } catch (error) {
                console.warn('⚠️ 待同步数据处理失败:', error);
            }
        }
        
        // 不再信任本地存储，直接使用服务器数据
        // 如果获取不到服务器数据，设置为0
        if (!userData || userData.credit === undefined) {
            console.warn('⚠️ 无法获取服务器货币数据，设置为0');
            userData = { credit: 0, nickname: userData?.nickname || 'Player' };
        }
        
        console.log('✅ 用户数据加载成功:', userData);
        return userData;
    } catch (error) {
        console.error('❌ 后端初始化失败:', error);
        // 发生错误时返回0，不再使用本地数据
        return { credit: 0, nickname: 'Player' };
    }
}

// 更新货币
export async function updateCurrency(currency) {
    try {
        console.log('💰 开始上传金钱到Supabase:', currency);
        const uuid = getUserUUID();
        console.log('🆔 用户UUID:', uuid);
        
        const result = await saveUserData({ credit: currency });
        console.log('✅ 金钱上传成功:', result);
        return result;
    } catch (error) {
        console.error('❌ 金钱上传失败:', error);
        throw error;
    }
}

// 更新昵称
export async function updateNickname(nickname) {
    return await saveUserData({ nickname });
}

// 更新设置
export async function updateSetting(setting) {
    try {
        const result = await saveUserData({ setting });
        console.log('⚙️ 设置保存成功:', setting);
        return result;
    } catch (error) {
        console.error('❌ 设置保存失败:', error);
        throw error;
    }
}

// 获取长期统计数据（存储在 session_history 列中）
export async function getLifetimeStats() {
    try {
        const uuid = getUserUUID();
        const { data, error } = await supabase
            .from('users')
            .select('session_history')
            .eq('uuid', uuid)
            .single();

        if (error) throw error;

        const stats = data?.session_history;
        if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
            return stats;
        }
        return null;
    } catch (err) {
        console.error('❌ 获取长期统计失败:', err);
        return null;
    }
}

// 上传长期统计结果
export async function uploadLifetimeStats(lifetimeStats) {
    try {
        const uuid = getUserUUID();
        const { error } = await supabase
            .from('users')
            .update({
                session_history: lifetimeStats,
                updated_at: new Date().toISOString()
            })
            .eq('uuid', uuid);

        if (error) throw error;
        console.log('✅ 长期统计已更新');
    } catch (err) {
        console.error('❌ 上传长期统计失败:', err);
        throw err;
    }
}

// 自动保存货币变化 - 已禁用
export function setupAutoSave(state) {
    console.log('💾 自动保存已禁用，将在游戏结束时保存');
    // 不再自动保存，改为游戏结束时手动保存
}

// 获取排行榜数据（默认按credit）
export async function getLeaderboard(limit = 50) {
    try {
        console.log('🏆 获取排行榜数据...');
        
        const { data, error } = await supabase
            .from('users')
            .select('nickname, credit, uuid, updated_at')
            .order('credit', { ascending: false });
            
        if (error) {
            console.error('❌ 获取排行榜数据失败:', error);
            return [];
        }
        
        // 过滤数据：排除昵称包含"Player"和credit小于等于2000的用户
        const filteredData = (data || []).filter(user => {
            const nickname = (user.nickname || '').toLowerCase();
            const hasPlayerInName = nickname.includes('player');
            const hasLowCredit = user.credit <= 2000;
            
            return !hasPlayerInName && !hasLowCredit;
        });
        
        // 限制返回数量
        const result = filteredData.slice(0, limit);
        
        console.log('✅ 排行榜数据获取成功:', {
            原始数据: data?.length || 0,
            过滤后: filteredData.length,
            返回: result.length
        });
        return result;
    } catch (error) {
        console.error('❌ 获取排行榜数据异常:', error);
        return [];
    }
}

// 按最高分数获取排行榜
export async function getLeaderboardByBestScore(limit = 50) {
    try {
        console.log('🏆 获取最高分数排行榜...');
        
        const { data, error } = await supabase
            .from('users')
            .select('nickname, session_history, uuid, updated_at')
            .not('session_history', 'is', null)
            .not('session_history->>bestScore', 'is', null);
            
        if (error) {
            console.error('❌ 获取最高分数排行榜失败:', error);
            return [];
        }
        
        // 过滤并排序
        const filteredData = (data || [])
            .filter(user => {
                const nickname = (user.nickname || '').toLowerCase();
                const hasPlayerInName = nickname.includes('player');
                const bestScore = user.session_history?.bestScore?.score || 0;
                const hasLowScore = bestScore <= 0;
                return !hasPlayerInName && !hasLowScore;
            })
            .map(user => ({
                nickname: user.nickname,
                bestScore: user.session_history?.bestScore?.score || 0,
                sessionId: user.session_history?.bestScore?.sessionId,
                timestamp: user.session_history?.bestScore?.timestamp,
                uuid: user.uuid,
                updated_at: user.updated_at
            }))
            .sort((a, b) => b.bestScore - a.bestScore)
            .slice(0, limit);
        
        console.log('✅ 最高分数排行榜获取成功:', {
            原始数据: data?.length || 0,
            过滤后: filteredData.length,
            返回: filteredData.length
        });
        return filteredData;
    } catch (error) {
        console.error('❌ 获取最高分数排行榜异常:', error);
        return [];
    }
}

// 按总击杀获取排行榜
export async function getLeaderboardByTotalKills(limit = 50) {
    try {
        console.log('🏆 获取总击杀排行榜...');

        const { data, error } = await supabase
            .from('users')
            .select('nickname, session_history, uuid, updated_at')
            .not('session_history', 'is', null);

        if (error) {
            console.error('❌ 获取总击杀排行榜失败:', error);
            return [];
        }

        // 过滤并排序
        const filteredData = (data || [])
            .filter(user => {
                const nickname = (user.nickname || '').toLowerCase();
                const hasPlayerInName = nickname.includes('player');
                const totalKills = user.session_history?.totalKills || 0;
                const hasLowKills = totalKills <= 0;
                return !hasPlayerInName && !hasLowKills;
            })
            .map(user => ({
                nickname: user.nickname,
                totalKills: user.session_history?.totalKills || 0,
                uuid: user.uuid,
                updated_at: user.updated_at
            }))
            .sort((a, b) => b.totalKills - a.totalKills)
            .slice(0, limit);

        console.log('✅ 总击杀排行榜获取成功:', {
            原始数据: data?.length || 0,
            过滤后: filteredData.length,
            返回: filteredData.length
        });
        return filteredData;
    } catch (error) {
        console.error('❌ 获取总击杀排行榜异常:', error);
        return [];
    }
}

// 辅助：根据UUID获取长期统计
export async function getLifetimeStatsByUUID(uuid) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('session_history')
            .eq('uuid', uuid)
            .single();

        if (error) throw error;

        const stats = data?.session_history;
        if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
            return stats;
        }
        return null;
    } catch (err) {
        console.error('❌ 获取他人长期统计失败:', err);
        return null;
    }
}