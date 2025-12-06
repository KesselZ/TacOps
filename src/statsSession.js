// 会话统计管理（内存缓存）
// 记录一局游戏内的各种数据，在游戏结束时统一上传

// 内存中的当前会话
let currentSession = null;

function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureWeaponEntry(weaponId, weaponName = 'Unknown') {
    if (!currentSession) return null;
    if (!currentSession.weapons[weaponId]) {
        currentSession.weapons[weaponId] = {
            id: weaponId,
            name: weaponName,
            shots: 0,
            hits: 0,
            kills: 0,
            damage: 0,
            score: 0,
            headshots: 0,
            bodyshots: 0
        };
    }
    return currentSession.weapons[weaponId];
}

export function startStatsSession(extra = {}) {
    currentSession = {
        id: generateSessionId(),
        startTime: Date.now(),
        endTime: null,
        duration: 0,
        weapons: {},
        summary: {
            totalKills: 0,
            totalScore: 0,
            totalShots: 0,
            totalHits: 0,
            totalDamage: 0,
            totalHeadshots: 0,
            totalBodyshots: 0
        },
        meta: {
            ...extra
        }
    };
    return currentSession.id;
}

export function recordWeaponShot({ weaponId = 'unknown', weaponName, damage = 0, isHit = false, hitLocation = 'body' } = {}) {
    if (!currentSession) return;
    const weapon = ensureWeaponEntry(weaponId, weaponName);
    weapon.shots += 1;
    weapon.damage += damage;
    currentSession.summary.totalShots += 1;
    currentSession.summary.totalDamage += damage;
    if (isHit) {
        weapon.hits += 1;
        currentSession.summary.totalHits += 1;
        if (hitLocation === 'head') {
            weapon.headshots += 1;
            currentSession.summary.totalHeadshots += 1;
        } else {
            weapon.bodyshots += 1;
            currentSession.summary.totalBodyshots += 1;
        }
    }
}

export function recordWeaponKill({ weaponId = 'unknown', weaponName, damage = 0, score = 0 } = {}) {
    if (!currentSession) return;
    const weapon = ensureWeaponEntry(weaponId, weaponName);
    weapon.kills += 1;
    weapon.damage += damage;
    weapon.score += score;
    currentSession.summary.totalKills += 1;
    currentSession.summary.totalDamage += damage;
    currentSession.summary.totalScore += score;
}

export function recordScore(scoreDelta = 0) {
    if (!currentSession) return;
    currentSession.summary.totalScore += scoreDelta;
}

export function recordMetaInfo(key, value) {
    if (!currentSession) return;
    currentSession.meta[key] = value;
}

export function getCurrentSessionStats() {
    if (!currentSession) return null;
    return structuredClone(currentSession);
}

function computeFavoriteWeapons(weaponsMap) {
    const weaponsArray = Object.values(weaponsMap);
    if (!weaponsArray.length) return [];
    return weaponsArray
        .map(weapon => ({
            ...weapon,
            accuracy: weapon.shots ? weapon.hits / weapon.shots : 0
        }))
        .sort((a, b) => b.score - a.score || b.kills - a.kills)
        .slice(0, 3);
}

export async function finalizeStatsSession({ result = 'unknown', extraSummary = {} } = {}) {
    if (!currentSession) {
        console.warn('No active session to finalize');
        return null;
    }

    currentSession.endTime = Date.now();
    currentSession.duration = (currentSession.endTime - currentSession.startTime) / 1000; // seconds
    currentSession.summary = {
        ...currentSession.summary,
        accuracy: currentSession.summary.totalShots
            ? currentSession.summary.totalHits / currentSession.summary.totalShots
            : 0,
        result,
        ...extraSummary
    };
    currentSession.favoriteWeapons = computeFavoriteWeapons(currentSession.weapons);

    const finishedSession = currentSession;
    currentSession = null;
    return finishedSession;
}

export function resetStatsSession() {
    currentSession = null;
}
