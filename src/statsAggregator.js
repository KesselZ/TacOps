// Lifetime statistics aggregator
// Accepts single-session data and merges into a long-term stats object

function deepClone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : null;
}

export function getDefaultLifetimeStats() {
    return {
        totalGames: 0,
        totalWins: 0,
        totalDefeats: 0,
        totalKills: 0,
        totalDamage: 0,
        totalScore: 0,
        totalShots: 0,
        totalHits: 0,
        totalHeadshots: 0,
        totalBodyshots: 0,
        totalDuration: 0,
        winRate: 0,
        accuracy: 0,
        weaponTotals: {},
        favoriteWeapons: [],
        bestScore: null,
        lastSession: null,
        lastUpdated: null
    };
}

function mergeWeaponTotals(existingTotals = {}, sessionWeapons = {}) {
    const totals = { ...existingTotals };

    Object.entries(sessionWeapons).forEach(([weaponId, weaponData]) => {
        const current = totals[weaponId] || {
            id: weaponId,
            name: weaponData.name || weaponId,
            shots: 0,
            hits: 0,
            kills: 0,
            damage: 0,
            score: 0,
            headshots: 0,
            bodyshots: 0
        };

        current.shots += weaponData.shots || 0;
        current.hits += weaponData.hits || 0;
        current.kills += weaponData.kills || 0;
        current.damage += weaponData.damage || 0;
        current.score += weaponData.score || 0;
        current.headshots += weaponData.headshots || 0;
        current.bodyshots += weaponData.bodyshots || 0;
        current.name = weaponData.name || current.name;

        totals[weaponId] = current;
    });

    return totals;
}

function getFavoriteWeapons(weaponTotals = {}, limit = 3) {
    return Object.values(weaponTotals)
        .map(item => ({
            ...item,
            accuracy: item.shots ? item.hits / item.shots : 0
        }))
        .sort((a, b) => {
            if (b.kills !== a.kills) return b.kills - a.kills;
            return (b.score || 0) - (a.score || 0);
        })
        .slice(0, limit);
}

export function mergeSessionIntoLifetime(existingStats, session) {
    const stats = deepClone(existingStats) || getDefaultLifetimeStats();
    const summary = session?.summary || {};

    stats.totalGames += 1;
    if (summary.result === 'extracted' || summary.result === 'win') {
        stats.totalWins += 1;
    } else {
        stats.totalDefeats += 1;
    }

    const kills = summary.totalKills || 0;
    const shots = summary.totalShots || 0;
    const hits = summary.totalHits || 0;
    const headshots = summary.totalHeadshots || 0;
    const bodyshots = summary.totalBodyshots || 0;
    const damage = summary.totalDamage || 0;
    const duration = session?.duration || 0;
    const score = summary.finalScore ?? summary.totalScore ?? 0;

    stats.totalKills += kills;
    stats.totalShots += shots;
    stats.totalHits += hits;
    stats.totalHeadshots += headshots;
    stats.totalBodyshots += bodyshots;
    stats.totalDamage += damage;
    stats.totalScore += score;
    stats.totalDuration += duration;

    stats.accuracy = stats.totalShots ? stats.totalHits / stats.totalShots : 0;
    stats.winRate = stats.totalGames ? stats.totalWins / stats.totalGames : 0;

    stats.weaponTotals = mergeWeaponTotals(stats.weaponTotals, session?.weapons);
    stats.favoriteWeapons = getFavoriteWeapons(stats.weaponTotals);

    if (!stats.bestScore || score > (stats.bestScore.score || 0)) {
        stats.bestScore = {
            score,
            sessionId: session?.id,
            timestamp: summary.timestamp || session?.endTime || Date.now()
        };
    }

    stats.lastSession = {
        sessionId: session?.id,
        result: summary.result,
        finalScore: score,
        kills,
        duration,
        timestamp: summary.timestamp || session?.endTime || Date.now()
    };

    stats.lastUpdated = Date.now();

    return stats;
}
