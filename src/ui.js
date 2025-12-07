import * as THREE from 'three';
import { state } from './globals.js';
import { getHealingProgress, getArmorRepairProgress } from './medical.js';
import { CONFIG } from './config.js';
import { updateSetting, getUserData, getLeaderboard, getLeaderboardByBestScore, getLeaderboardByTotalKills, getLifetimeStats, getUserDataByUUID, getLifetimeStatsByUUID } from './backend_client.js';
import { getDefaultLifetimeStats } from './statsAggregator.js';
import { getChangelogHTML } from '../data/changelog.js';
import { updateCrosshairStyle } from './weapon.js';

let scoreAnimStart = 0;
let scoreAnimFrom = 0;
let scoreAnimTo = 0;
const SCORE_BONUS_BUFFER_MS = 1500;
const SCORE_ANIM_DURATION_MS = 400;

// 懒加载创建的 F 键交互提示元素
let interactHintEl = null;

// 记录打开挑战终端前是否处于指针锁定状态
let wasPointerLockedBeforeTerminal = false;

// 挑战模式终端 UI 状态
let challengeTerminalPanelEl = null;
let challengeTerminalOverlayEl = null;

// 终端升级：固定价格与成长
const CHALLENGE_UPGRADE_COST = 800;       // 每次升级固定 800 分
const CHALLENGE_HP_STEP = 20;             // 每级 +20 HP
const CHALLENGE_DMG_STEP = 0.10;          // 每级 +10% 伤害
const CHALLENGE_AMMO_STEP = 0.20;         // 每级 +20% 备弹上限

function getOrCreateInteractHintEl() {
    if (interactHintEl && interactHintEl.parentNode) return interactHintEl;
    const el = document.createElement('div');
    el.id = 'interact-hint';
    el.style.position = 'fixed';
    el.style.left = '50%';
    // 放在准星正下方一点：屏幕中线略下
    el.style.top = '52%';
    el.style.transform = 'translateX(-50%) translateY(0)';
    el.style.padding = '6px 12px';
    el.style.borderRadius = '999px';
    el.style.background = 'rgba(15,23,42,0.85)';
    el.style.border = '1px solid rgba(148,163,184,0.8)';
    el.style.color = '#e5e7eb';
    el.style.fontSize = '12px';
    el.style.letterSpacing = '0.08em';
    el.style.textTransform = 'uppercase';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '9999';
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.12s ease-out, transform 0.12s ease-out';
    el.textContent = '';
    document.body.appendChild(el);
    interactHintEl = el;
    return el;
}

function ensureChallengeTerminalState() {
    if (typeof state.challengeTerminal === 'object') {
        // 确保基础数值存在
        if (typeof state.challengeTerminal.baseMaxHealth !== 'number') {
            state.challengeTerminal.baseMaxHealth = typeof state.maxHealth === 'number' ? state.maxHealth : 100;
        }
        if (typeof state.challengeTerminal.baseMaxReserve !== 'number') {
            const currentMaxReserve = typeof state.maxReserveAmmo === 'number' ? state.maxReserveAmmo : CONFIG.totalAmmo;
            state.challengeTerminal.baseMaxReserve = currentMaxReserve;
        }
        return;
    }

    // 记录基础值，避免覆盖其他模式的默认配置
    const baseMaxHealth = typeof state.maxHealth === 'number' ? state.maxHealth : 100;
    const baseMaxReserve = typeof state.maxReserveAmmo === 'number' ? state.maxReserveAmmo : CONFIG.totalAmmo;
    state.challengeTerminal = {
        baseMaxHealth,
        baseMaxReserve,
        hpLevel: 0,
        dmgLevel: 0,
        ammoLevel: 0
    };
}

function getOrCreateChallengeTerminalOverlay() {
    if (challengeTerminalOverlayEl && challengeTerminalOverlayEl.parentNode) return challengeTerminalOverlayEl;
    const overlay = document.createElement('div');
    overlay.id = 'challenge-terminal-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(15,23,42,0.75)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.style.zIndex = '9998';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    document.body.appendChild(overlay);
    challengeTerminalOverlayEl = overlay;
    return overlay;
}

function getOrCreateChallengeTerminalPanel() {
    if (challengeTerminalPanelEl && challengeTerminalPanelEl.parentNode) return challengeTerminalPanelEl;
    const panel = document.createElement('div');
    panel.id = 'challenge-terminal-panel';
    panel.style.minWidth = '420px';
    panel.style.maxWidth = '520px';
    panel.style.background = 'rgba(15,23,42,0.98)';
    panel.style.border = '1px solid rgba(148,163,184,0.9)';
    panel.style.borderRadius = '12px';
    panel.style.padding = '16px 20px 18px 20px';
    panel.style.color = '#e5e7eb';
    panel.style.fontSize = '14px';
    panel.style.boxShadow = '0 18px 45px rgba(15,23,42,0.9)';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '12px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '4px';

    const title = document.createElement('div');
    title.textContent = '挑战终端';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    header.appendChild(title);

    const scoreLabel = document.createElement('div');
    scoreLabel.id = 'challenge-terminal-score';
    scoreLabel.style.fontSize = '13px';
    scoreLabel.style.color = '#a5b4fc';
    header.appendChild(scoreLabel);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.marginLeft = '12px';
    closeBtn.style.width = '28px';
    closeBtn.style.height = '28px';
    closeBtn.style.borderRadius = '999px';
    closeBtn.style.border = '1px solid rgba(148,163,184,0.7)';
    closeBtn.style.background = 'rgba(15,23,42,0.9)';
    closeBtn.style.color = '#e5e7eb';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(30,64,175,0.9)'; };
    closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(15,23,42,0.9)'; };
    closeBtn.onclick = () => closeChallengeTerminalUI();
    header.appendChild(closeBtn);

    panel.appendChild(header);

    const desc = document.createElement('div');
    desc.textContent = '使用本局 mission score 购买强化，仅在当前挑战局内生效。';
    desc.style.fontSize = '12px';
    desc.style.color = '#9ca3af';
    desc.style.marginBottom = '4px';
    panel.appendChild(desc);

    const list = document.createElement('div');
    list.id = 'challenge-terminal-list';
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    panel.appendChild(list);

    const footer = document.createElement('div');
    footer.style.marginTop = '6px';
    footer.style.fontSize = '11px';
    footer.style.color = '#6b7280';
    footer.textContent = '提示：四个终端共享强化等级，多次访问不会重复收费。';
    panel.appendChild(footer);

    challengeTerminalPanelEl = panel;
    return panel;
}

function renderChallengeTerminalRows() {
    ensureChallengeTerminalState();
    const list = document.getElementById('challenge-terminal-list');
    if (!list) return;
    list.innerHTML = '';

    const scoreVal = typeof state.score === 'number' ? state.score : 0;
    const scoreLabel = document.getElementById('challenge-terminal-score');
    if (scoreLabel) {
        scoreLabel.textContent = `当前分数：${scoreVal}`;
    }

    const baseMaxHealth = state.challengeTerminal.baseMaxHealth || (typeof state.maxHealth === 'number' ? state.maxHealth : 100);
    const baseMaxReserve = state.challengeTerminal.baseMaxReserve || (typeof state.maxReserveAmmo === 'number' ? state.maxReserveAmmo : CONFIG.totalAmmo);

    const items = [
        {
            id: 'hp',
            title: '最大生命',
            levelKey: 'hpLevel',
            getCurrentText: (lvl) => {
                const cur = baseMaxHealth + lvl * CHALLENGE_HP_STEP;
                return `${cur} HP`;
            },
            getNextText: (lvl) => {
                const nxt = baseMaxHealth + (lvl + 1) * CHALLENGE_HP_STEP;
                return `${nxt} HP`;
            },
            getEffectText: () => `每次 +${CHALLENGE_HP_STEP} HP`
        },
        {
            id: 'dmg',
            title: '子弹伤害',
            levelKey: 'dmgLevel',
            getCurrentText: (lvl) => {
                const mult = 1 + lvl * CHALLENGE_DMG_STEP;
                return `${(mult * 100).toFixed(0)}%`;
            },
            getNextText: (lvl) => {
                const mult = 1 + (lvl + 1) * CHALLENGE_DMG_STEP;
                return `${(mult * 100).toFixed(0)}%`;
            },
            getEffectText: () => `每次 +${(CHALLENGE_DMG_STEP * 100).toFixed(0)}%`
        },
        {
            id: 'ammo',
            title: '备弹上限',
            levelKey: 'ammoLevel',
            getCurrentText: (lvl) => {
                const mult = 1 + lvl * CHALLENGE_AMMO_STEP;
                return `${(mult * 100).toFixed(0)}%（${Math.round(baseMaxReserve * mult)} 发）`;
            },
            getNextText: (lvl) => {
                const mult = 1 + (lvl + 1) * CHALLENGE_AMMO_STEP;
                return `${(mult * 100).toFixed(0)}%（${Math.round(baseMaxReserve * mult)} 发）`;
            },
            getEffectText: () => `每次 +${(CHALLENGE_AMMO_STEP * 100).toFixed(0)}%`
        }
    ];

    for (const item of items) {
        const level = state.challengeTerminal[item.levelKey] || 0;

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '8px 10px';
        row.style.borderRadius = '10px';
        row.style.background = 'rgba(15,23,42,0.9)';
        row.style.border = '1px solid rgba(55,65,81,0.9)';

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.flexDirection = 'column';

        const nameEl = document.createElement('div');
        nameEl.textContent = item.title;
        nameEl.style.fontWeight = '500';
        left.appendChild(nameEl);

        const sub = document.createElement('div');
        sub.style.fontSize = '11px';
        sub.style.color = '#9ca3af';

        const curText = item.getCurrentText(level);
        const nextText = item.getNextText(level);
        sub.textContent = `当前：${curText}   →   下一级：${nextText}（每次 ${item.getEffectText()}，价格：${CHALLENGE_UPGRADE_COST} 分）`;
        left.appendChild(sub);

        const right = document.createElement('div');

        const btn = document.createElement('button');
        btn.style.minWidth = '120px';
        btn.style.padding = '6px 10px';
        btn.style.borderRadius = '999px';
        btn.style.border = '1px solid rgba(96,165,250,0.9)';
        btn.style.background = 'rgba(15,23,42,0.95)';
        btn.style.color = '#e5e7eb';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';

        const cost = CHALLENGE_UPGRADE_COST;
        if (scoreVal >= cost) {
            btn.textContent = `使用 ${cost} 分购买`;
            btn.onmouseenter = () => { btn.style.background = 'rgba(37,99,235,0.95)'; };
            btn.onmouseleave = () => { btn.style.background = 'rgba(15,23,42,0.95)'; };
            btn.onclick = () => {
                if (typeof state.score !== 'number') state.score = 0;
                if (state.score < cost) {
                    renderChallengeTerminalRows();
                    return;
                }
                state.score -= cost;
                state.challengeTerminal[item.levelKey] = (state.challengeTerminal[item.levelKey] || 0) + 1;

                const newLevel = state.challengeTerminal[item.levelKey];

                if (item.id === 'hp') {
                    const newMax = baseMaxHealth + newLevel * CHALLENGE_HP_STEP;
                    state.maxHealth = newMax;
                    if (typeof state.health !== 'number') state.health = newMax;
                    const healAmount = 30;
                    state.health = Math.min(state.health + healAmount, state.maxHealth);
                } else if (item.id === 'dmg') {
                    const mult = 1 + newLevel * CHALLENGE_DMG_STEP;
                    state.challengeDamageMultiplier = mult;
                } else if (item.id === 'ammo') {
                    const mult = 1 + newLevel * CHALLENGE_AMMO_STEP;
                    state.challengeReserveAmmoMultiplier = mult;

                    // 使用记录下来的基础上限重新计算本局最大备用弹药
                    const newMaxReserve = Math.round(baseMaxReserve * mult);
                    state.maxReserveAmmo = newMaxReserve;
                    // 不强行补满，只保证当前备用弹药不超过新上限
                    if (typeof state.reserveAmmo === 'number') {
                        state.reserveAmmo = Math.min(state.reserveAmmo, state.maxReserveAmmo);
                    }
                }

                renderChallengeTerminalRows();
            };
        } else {
            btn.textContent = '分数不足';
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.style.borderColor = 'rgba(75,85,99,0.9)';
            btn.style.cursor = 'default';
        }

        right.appendChild(btn);
        row.appendChild(left);
        row.appendChild(right);
        list.appendChild(row);
    }
}

export function openChallengeTerminalUI() {
    if (typeof document === 'undefined') return;
    ensureChallengeTerminalState();
    const overlay = getOrCreateChallengeTerminalOverlay();
    const panel = getOrCreateChallengeTerminalPanel();
    if (!panel.parentNode) overlay.appendChild(panel);
    overlay.style.display = 'flex';
    renderChallengeTerminalRows();
    state.isPaused = true;

    // 打开终端时：如果当前已锁定指针，先记录并解除锁定以显示鼠标
    wasPointerLockedBeforeTerminal = (document.pointerLockElement === document.body);
    if (wasPointerLockedBeforeTerminal && document.exitPointerLock) {
        document.exitPointerLock();
    }

    // 隐藏 F 交互提示，避免与终端 UI 重叠
    if (interactHintEl) {
        interactHintEl.style.opacity = '0';
        interactHintEl.style.transform = 'translateX(-50%) translateY(4px)';
    }
}

export function closeChallengeTerminalUI() {
    if (challengeTerminalOverlayEl) {
        challengeTerminalOverlayEl.style.display = 'none';
    }
    state.isPaused = false;

    // 关闭终端后：如果之前处于指针锁定状态，则尝试恢复
    if (wasPointerLockedBeforeTerminal && typeof document !== 'undefined') {
        const canvas = document.querySelector('canvas');
        if (canvas && canvas.requestPointerLock) {
            canvas.requestPointerLock();
        }
    }
}

// 统一的成就配置生成函数
function getAchievementsConfig(lifetimeStats) {
    const totalGames = lifetimeStats.totalGames || 0;
    const totalKills = lifetimeStats.totalKills || 0;
    const totalSeconds = lifetimeStats.totalDuration || 0;
    const totalHours = totalSeconds / 3600;
    
    return [
        {
            id: 'recruit',
            icon: '🪖',
            name: '新兵',
            description: '完成第一局游戏',
            unlocked: totalSeconds > 0
        },
        {
            id: 'sharpshooter',
            icon: '🎯',
            name: '神射手',
            description: '命中率达到 40% 以上',
            unlocked: lifetimeStats.totalShots > 0 && lifetimeStats.accuracy >= 0.4
        },
        {
            id: 'collector',
            icon: '💎',
            name: '收藏家',
            description: '累计击杀达到 100',
            unlocked: totalKills >= 100
        }
    ];
}

export function updateUI() {
    const scoreEl = document.getElementById('score');
    const scoreBonusEl = document.getElementById('score-bonus');
    const now = performance.now();

    if (typeof state.scoreAnimatedValue !== 'number') {
        state.scoreAnimatedValue = state.score || 0;
    }

    if (typeof state.scoreBonusValue !== 'number') {
        state.scoreBonusValue = 0;
    }

    if (state.scoreBonusExpiresAt && now >= state.scoreBonusExpiresAt) {
        state.scoreBonusExpiresAt = 0;
        if (scoreBonusEl) {
            scoreBonusEl.style.opacity = '0';
            scoreBonusEl.style.transform = 'translateY(8px) scale(1)';
            scoreBonusEl.textContent = '';
        }
        if (state.scoreAnimatedValue !== state.score) {
            scoreAnimFrom = state.scoreAnimatedValue;
            scoreAnimTo = state.score || 0;
            scoreAnimStart = now;
        }
        state.scoreBonusValue = 0;
    }

    if (scoreAnimStart) {
        const t = (now - scoreAnimStart) / SCORE_ANIM_DURATION_MS;
        if (t >= 1) {
            state.scoreAnimatedValue = state.score || 0;
            scoreAnimStart = 0;
        } else {
            const k = t < 0 ? 0 : t;
            state.scoreAnimatedValue = scoreAnimFrom + (scoreAnimTo - scoreAnimFrom) * k;
        }
    }

    // F 键交互提示（掉落物 / 箱子等）
    const hasPointerLock = typeof document !== 'undefined' && document.pointerLockElement === document.body;
    if (state.isGameActive && !state.isPaused && hasPointerLock) {
        const fObj = state.focusedInteractable;
        const el = getOrCreateInteractHintEl();
        if (fObj) {
            let text = '按 F 交互';
            if (fObj.type === 'pickup') {
                text = '按 F 拾取';
            } else if (fObj.type === 'container') {
                text = '按 F 打开容器';
            }
            el.textContent = text;
            el.style.opacity = '1';
            el.style.transform = 'translateX(-50%) translateY(0)';
        } else if (interactHintEl) {
            interactHintEl.style.opacity = '0';
            interactHintEl.style.transform = 'translateX(-50%) translateY(4px)';
        }
    } else if (interactHintEl) {
        interactHintEl.style.opacity = '0';
        interactHintEl.style.transform = 'translateX(-50%) translateY(4px)';
    }

    if (scoreEl) {
        scoreEl.innerText = Math.floor(state.scoreAnimatedValue || 0);
    }
    if (scoreBonusEl && state.scoreBonusValue > 0 && state.scoreBonusExpiresAt && now < state.scoreBonusExpiresAt) {
        scoreBonusEl.textContent = `+${state.scoreBonusValue}`;
        scoreBonusEl.style.opacity = '1';

        const lastUpdate = state.scoreBonusLastUpdate || 0;
        const elapsed = now - lastUpdate;
        // 前 ~120ms 超大幅放大，之后收回到正常尺寸，形成“拍一下再落下”的感觉
        if (elapsed <= 120) {
            scoreBonusEl.style.transform = 'translateY(-8px) scale(1.9)';
        } else {
            scoreBonusEl.style.transform = 'translateY(0px) scale(1.0)';
        }
    }
    const hpEl = document.getElementById('health-val'); if(hpEl) hpEl.innerText = Math.floor(state.health);
    const armorEl = document.getElementById('armor-val'); if(armorEl) armorEl.innerText = Math.floor(state.armor);
    const amEl = document.getElementById('ammo-current'); if(amEl) amEl.innerText = state.ammo;
    const amtEl = document.getElementById('ammo-total'); if(amtEl) amtEl.innerText = state.reserveAmmo;
    const curEl = document.getElementById('currency-val'); if(curEl) curEl.innerText = state.currency;
    
    // 医疗包UI
    const medkitEl = document.getElementById('medkit-val');
    if(medkitEl) medkitEl.innerText = Math.floor(state.medkits);
    const armorKitEl = document.getElementById('armorkit-val');
    if(armorKitEl) armorKitEl.innerText = Math.floor(state.armorKits);
    
    
    // 各向异性过滤由设置面板控制，此处不再重置
    
    // 医疗读条UI
    const medicalProgress = document.getElementById('medical-progress');
    const medicalBar = document.getElementById('medical-bar');
    const medicalText = document.getElementById('medical-text');
    
    if (state.isHealing) {
        if(medicalProgress) medicalProgress.style.display = 'block';
        const progress = getHealingProgress();
        if(medicalBar) medicalBar.style.width = (progress * 100) + '%';
        if(medicalText) {
            if(progress < 1) {
                medicalText.textContent = '💊 使用绷带中... ' + Math.floor(progress * 100) + '%';
                medicalText.style.color = '#ffaa00';
            } else {
                medicalText.textContent = '💚 回复中... ' + Math.floor(state.health) + ' HP (移动速度-70%)';
                medicalText.style.color = '#00ff00';
            }
        }
        if(medicalBar) medicalBar.style.background = 'linear-gradient(90deg, #00ff00, #00cc00)';
    } else if (state.isRepairingArmor) {
        if(medicalProgress) medicalProgress.style.display = 'block';
        const progress = getArmorRepairProgress();
        if(medicalBar) medicalBar.style.width = (progress * 100) + '%';
        if(medicalText) {
            if(progress < 1) {
                medicalText.textContent = '🔧 修复护甲中... ' + Math.floor(progress * 100) + '%';
                medicalText.style.color = '#ffaa00';
            } else {
                medicalText.textContent = '🛡️ 修复中... ' + Math.floor(state.armor) + ' Armor (移动速度-70%)';
                medicalText.style.color = '#00ccff';
            }
        }
        if(medicalBar) medicalBar.style.background = 'linear-gradient(90deg, #00ccff, #0099ff)';
    } else {
        if(medicalProgress) medicalProgress.style.display = 'none';
    }
    const dbg = document.getElementById('debug-panel');
    if (dbg) {
        // 平滑 FPS：每 0.5 秒更新一次显示，使用简单指数平均
        const rawFps = state.frameFps || 0;
        const now = performance.now();
        if (!state.lastFpsUpdateTime) state.lastFpsUpdateTime = now;
        if (now - state.lastFpsUpdateTime >= 500) { // 每 0.5 秒更新一次
            const alpha = 0.5; // 平滑系数：0.5 表示新旧各一半
            state.displayFps = state.displayFps > 0
                ? state.displayFps * (1 - alpha) + rawFps * alpha
                : rawFps;
            state.lastFpsUpdateTime = now;
        }
        const fps = state.displayFps || rawFps;

        // 渲染统计：只统计主相机的 draw call 数和三角形数量
        const drawCalls = state.mainRenderStats ? state.mainRenderStats.drawCalls : 0;
        const triangles = state.mainRenderStats ? state.mainRenderStats.triangles : 0;

        const line0 = `FPS: ${fps.toFixed(1)}`;

        // 根据设置控制是否显示完整调试信息
        if (!state.showPerfDetails) {
            dbg.textContent = line0;
        } else {
            const grounded = state.isGrounded ? 'GROUND' : 'AIR';
            const velocity = (state.playerBody && state.playerBody.velocity) ? state.playerBody.velocity : { x: 0, y: 0, z: 0 };
            const distance = state.groundDistance || 0;
            const object = state.groundObject || '未知';
            const normalY = state.groundNormalY || 0;
            const cannonContact = state.cannonContactPoint || '无';
            const rayStart = state.rayStartPoint || '无';

            const line1 = `STATE: ${grounded}`;
            const line2 = `VX: ${velocity.x.toFixed(2)} VY: ${velocity.y.toFixed(2)} VZ: ${velocity.z.toFixed(2)}`;
            const line3 = `距离: ${distance.toFixed(2)}m`;
            const line4 = `法线Y: ${normalY.toFixed(3)}`;
            const line5 = `射线起点: ${rayStart}`;
            const line6 = `Cannon接触: ${cannonContact}`;
            const line7 = `物体: ${object}`;
            const line8 = `DrawCalls: ${drawCalls}  Tris: ${triangles}`;
            const slideStatus = state.isSliding ? `是 (${(state.slideTime || 0).toFixed(2)}s)` : '否';
            const line9 = `滑铲: ${slideStatus}`;
            dbg.textContent = line0 + '\n' + line1 + '\n' + line2 + '\n' + line3 + '\n' + line4 + '\n' + line5 + '\n' + line6 + '\n' + line7 + '\n' + line8 + '\n' + line9;
        }
    }
    
    // 真实同步：准星映射
    // Note: state.camera needs to be initialized
    if (!state.camera) return;

    const halfFovRad = THREE.MathUtils.degToRad(state.camera.fov / 2);
    const spreadRad = THREE.MathUtils.degToRad(state.currentSpreadAngle); 
    const screenHeight = window.innerHeight;
    const spreadPx = (Math.tan(spreadRad) / Math.tan(halfFovRad)) * (screenHeight / 2);
    const finalPx = spreadPx + 4; 

    const l = document.getElementById('ch-l'); if(l) l.style.transform = `translateX(${-finalPx}px)`;
    const r = document.getElementById('ch-r'); if(r) r.style.transform = `translateX(${finalPx}px)`;
    const t = document.getElementById('ch-t'); if(t) t.style.transform = `translateY(${-finalPx}px)`;
    const b = document.getElementById('ch-b'); if(b) b.style.transform = `translateY(${finalPx}px)`;
}

// 全局加载遮罩控制（可复用）
export function showGlobalLoading(text = 'LOADING...', subtext = 'Preparing tactical environment') {
    const overlay = document.getElementById('global-loading-overlay');
    if (!overlay) return;
    const textEl = document.getElementById('global-loading-text');
    const subEl = document.getElementById('global-loading-subtext');
    if (textEl) textEl.textContent = text;
    if (subEl) subEl.textContent = subtext;
    // 页面加载时，为游戏画面添加暗化+模糊效果
    if (document && document.body) {
        document.body.classList.add('loading-active');
    }
    overlay.style.display = 'flex';
    // 触发一次重绘，确保过渡生效
    overlay.getBoundingClientRect();
    overlay.classList.remove('hidden');
}

export function hideGlobalLoading() {
    const overlay = document.getElementById('global-loading-overlay');
    if (!overlay) return;
    // 先移除画面的暗化+模糊效果，让游戏从暗淡模糊过渡到清晰
    if (document && document.body) {
        document.body.classList.remove('loading-active');
    }
    overlay.classList.add('hidden');
    // 动画结束后彻底隐藏
    setTimeout(() => {
        overlay.style.display = 'none';
    }, 400);
}

export function addScore(amount) {
    if (!state.isGameActive || !amount) return;
    if (typeof state.score !== 'number') state.score = 0;
    
    // 根据难度调整分数倍率
    let scoreMultiplier = 1.0;
    if (state.selectedDifficulty === 'hard') {
        scoreMultiplier = 1.5; // 中等难度分数提升50%
    } else if (state.selectedDifficulty === 'insane') {
        scoreMultiplier = 3.0; // 疯狂难度分数为基础值的3倍
    }
    
    const finalAmount = Math.round(amount * scoreMultiplier);
    const now = performance.now();
    state.score += finalAmount;
    if (typeof state.scoreAnimatedValue !== 'number') {
        state.scoreAnimatedValue = state.score;
    }
    if (typeof state.scoreBonusValue !== 'number') {
        state.scoreBonusValue = 0;
    }
    if (state.scoreBonusExpiresAt && now < state.scoreBonusExpiresAt) {
        state.scoreBonusValue += finalAmount;
    } else {
        state.scoreBonusValue = finalAmount;
    }
    state.scoreBonusExpiresAt = now + SCORE_BONUS_BUFFER_MS;
    state.scoreBonusLastUpdate = now;
}

export function showHitmarker(isHead) {
    console.log(`🎯 击中反馈触发: ${isHead ? '爆头' : '身体'}`);
    const el = document.getElementById('hit-feedback');
    const lines = el.querySelectorAll('.hit-line');
    
    if (!el) {
        console.warn('❌ 击中反馈元素未找到: #hit-feedback');
        return;
    }
    if (lines.length === 0) {
        console.warn('❌ 击中反馈线条未找到: .hit-line');
        return;
    }
    
    console.log(`✅ 击中反馈元素找到: ${lines.length} 条线条`);
    
    if (isHead) {
        lines.forEach(l => {
            l.style.backgroundColor = '#ff3333';
            l.style.boxShadow = '0 0 6px rgba(255,50,50,1), 0 0 12px rgba(255,100,100,0.6)';
        });
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = 'hit-anim-headshot 0.15s ease-out';
    } else {
        lines.forEach(l => {
            l.style.backgroundColor = 'white';
            l.style.boxShadow = '0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(255,255,255,0.3)';
        });
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = 'hit-anim 0.12s ease-out';
    }
}

export function showKill(isHead) {
    // 只有在游戏活跃时才显示击杀信息
    if (!state.isGameActive) return;
}

export function toggleReloadIndicator(visible) {
    // 只有在游戏活跃时才显示换弹指示器
    if (!state.isGameActive) return;
    
    const el = document.getElementById('reload-indicator');
    if (el) el.style.display = visible ? 'block' : 'none';
}

export function showMenu(show, finalScore = null) {
    const overlay = document.getElementById('stash-overlay');
    
    // 控制游戏UI元素的显示
    const gameUIElements = [
        'score',           // 分数
        'crosshair-wrapper', // 准星
        'hit-feedback',    // 受击反馈
        'reload-indicator', // 换弹指示器
        'stats-bar',       // 状态栏（血量、护甲、弹药、医疗包）
        'kill-feed',       // 击杀信息
        'debug-panel'      // 右上角监控栏
    ];
    
    if(show) {
        // 更新左上角玩家昵称显示
        const nameEl = document.getElementById('player-name-label');
        if (nameEl) {
            nameEl.textContent = state.playerName || 'Player';
        }

        // 如果玩家仍然叫 Player，并且本轮还没提示过，则自动弹出改名界面
        const renameOverlay = document.getElementById('rename-overlay');
        if (state.playerName === 'Player' && !state.hasSeenRenamePrompt && renameOverlay) {
            renameOverlay.style.display = 'flex';
            state.hasSeenRenamePrompt = true;
            const input = document.getElementById('rename-input');
            const cancelBtn = document.getElementById('rename-cancel');
            // 初始化时强制改名：不允许取消，隐藏 CANCEL 按钮
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (input) {
                input.value = state.playerName || '';
                input.focus();
                input.select();
            }
        }
        // 显示主菜单时隐藏所有游戏UI元素
        gameUIElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // 主菜单下强制隐藏局内背包UI
        const backpackOverlay = document.getElementById('backpack-overlay');
        if (backpackOverlay) {
            backpackOverlay.style.display = 'none';
        }
        
        overlay.style.display = 'flex';
        // 不再显示任务结束信息，避免影响info栏位
    } else {
        // 隐藏主菜单时显示所有游戏UI元素
        gameUIElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
        
        overlay.style.display = 'none';
    }
}

export function triggerDamageOverlay() {
    // 只有在游戏活跃时才显示受击效果
    if (!state.isGameActive) return;
    
    const overlay = document.getElementById('damage-overlay');
    overlay.style.opacity = 0.8; 
    setTimeout(() => overlay.style.opacity = 0, 200);
}

export function showPauseMenu(show) {
    const overlay = document.getElementById('pause-overlay');
    if (!overlay) return;
    overlay.style.display = show ? 'flex' : 'none';
    
    if (show) {
        // 设置按钮为禁用状态
        setPauseMenuButtonsEnabled(false);
        // 1秒后启用按钮
        setTimeout(() => {
            setPauseMenuButtonsEnabled(true);
        }, 1000);
    }
}

function setPauseMenuButtonsEnabled(enabled) {
    const buttons = document.querySelectorAll('.pause-option');
    buttons.forEach(btn => {
        btn.style.opacity = enabled ? '1' : '0.5';
        btn.style.pointerEvents = enabled ? 'auto' : 'none';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    });
}

export function initPauseMenuEvents() {
    const resumeEl = document.getElementById('pause-opt-continue');
    const settingsEl = document.getElementById('pause-opt-settings');
    const exitEl = document.getElementById('pause-opt-exit');

    if (resumeEl) {
        resumeEl.addEventListener('click', () => {
            const now = performance.now();
            if (now < state.pauseCooldownUntil) {
                // 还在冷却期，不响应点击
                return;
            }
            if (window.resumeGameFromPause) window.resumeGameFromPause();
        });
    }

    if (settingsEl) {
        settingsEl.addEventListener('click', () => {
            const now = performance.now();
            if (now < state.pauseCooldownUntil) {
                // 还在冷却期，不响应点击
                return;
            }
            // 打开设置界面
            showSettingsMenu();
        });
    }

    if (exitEl) {
        exitEl.addEventListener('click', () => {
            const now = performance.now();
            if (now < state.pauseCooldownUntil) {
                // 还在冷却期，不响应点击
                return;
            }
            if (window.exitToMenuFromPause) window.exitToMenuFromPause();
        });
    }

    // 初始化信息按钮事件
    initInfoButtonsEvents();
}

// 可复用的弹窗组件
export function showModal(title, content, options = {}) {
    const {
        width = '500px',
        height = '600px',
        showCloseButton = true,
        closeOnBackdrop = true,
        customClass = ''
    } = options;

    // 确保 modal 内容区域的滚动条使用深色主题样式
    if (document && document.head && !document.getElementById('modal-scrollbar-style')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'modal-scrollbar-style';
        styleEl.textContent = `
            .modal-content::-webkit-scrollbar {
                width: 8px;
            }
            .modal-content::-webkit-scrollbar-track {
                background: rgba(17, 24, 39, 0.9);
            }
            .modal-content::-webkit-scrollbar-thumb {
                background: #4b5563;
                border-radius: 999px;
            }
            .modal-content::-webkit-scrollbar-thumb:hover {
                background: #6b7280;
            }
        `;
        document.head.appendChild(styleEl);
    }

    // 创建弹窗遮罩
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.3s ease;
    `;

    // 创建弹窗容器
    const modal = document.createElement('div');
    modal.className = `modal-container ${customClass}`;
    modal.style.cssText = `
        background: linear-gradient(135deg, #1a1a1a, #2d2d2d);
        border: 2px solid #374151;
        border-left: 4px solid #eab308;
        border-radius: 8px;
        width: ${width};
        max-width: 90vw;
        height: ${height};
        max-height: 90vh;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
        transform: scale(0.9) translateY(20px);
        transition: transform 0.3s ease;
        display: flex;
        flex-direction: column;
    `;

    // 创建弹窗头部
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.cssText = `
        padding: 20px 24px;
        border-bottom: 1px solid #374151;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(0, 0, 0, 0.3);
    `;

    const titleEl = document.createElement('h2');
    titleEl.className = 'modal-title';
    titleEl.style.cssText = `
        margin: 0;
        color: #eab308;
        font-size: 1.5rem;
        font-weight: 600;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
    `;
    titleEl.textContent = title;

    header.appendChild(titleEl);

    // 关闭按钮
    if (showCloseButton) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn';
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #9ca3af;
            font-size: 1.5rem;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
        `;
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.color = '#eab308';
            closeBtn.style.background = 'rgba(234, 179, 8, 0.1)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.color = '#9ca3af';
            closeBtn.style.background = 'none';
        });
        closeBtn.addEventListener('click', () => closeModal());
        header.appendChild(closeBtn);
    }

    // 创建弹窗内容区域
    const contentEl = document.createElement('div');
    contentEl.className = 'modal-content';
    contentEl.style.cssText = `
        padding: 24px;
        overflow-y: auto;
        flex: 1;
        color: #e5e7eb;
        line-height: 1.6;
    `;
    
    if (typeof content === 'string') {
        contentEl.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        contentEl.appendChild(content);
    }

    // 组装弹窗
    modal.appendChild(header);
    modal.appendChild(contentEl);
    overlay.appendChild(modal);

    // 关闭弹窗函数
    function closeModal() {
        overlay.style.opacity = '0';
        modal.style.transform = 'scale(0.9) translateY(20px)';
        setTimeout(() => {
            // 检查overlay是否还在DOM中，避免重复移除
            if (overlay && overlay.parentNode === document.body) {
                document.body.removeChild(overlay);
            }
            // 移除事件监听器
            document.removeEventListener('keydown', handleEsc);
        }, 300);
    }

    // 点击背景关闭
    if (closeOnBackdrop) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        });
    }

    // ESC键关闭
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    document.addEventListener('keydown', handleEsc);

    // 添加到页面并显示动画
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'scale(1) translateY(0)';
    });

    return Object.assign(closeModal, { contentEl, modal });
}

// 显示个人信息
export async function showPersonalInfo() {
    // 显示加载状态
    const loadingContent = `
        <div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #9ca3af;">
            <div style="text-align: center;">
                <div style="font-size: 2rem; margin-bottom: 16px;">👤</div>
                <div>正在加载个人信息...</div>
            </div>
        </div>
    `;
    
    const closeModal = showModal('个人信息', loadingContent, {
        width: '500px',
        height: '600px'
    });
    
    try {
        // 获取当前用户数据与长期统计
        const [userData, lifetimeStats] = await Promise.all([
            getUserData(),
            (async () => (await getLifetimeStats()) || getDefaultLifetimeStats())()
        ]);

        const totalGames = lifetimeStats.totalGames || 0;
        const totalWins = lifetimeStats.totalWins || 0;
        const totalKills = lifetimeStats.totalKills || 0;
        const totalSeconds = lifetimeStats.totalDuration || 0;
        const totalHours = totalSeconds / 3600;
        const totalMinutes = totalSeconds / 60;
        let displayHours;
        if (totalSeconds <= 0) {
            displayHours = '--';
        } else if (totalHours < 1) {
            displayHours = `${Math.max(1, Math.round(totalMinutes))} 分钟`;
        } else {
            displayHours = `${totalHours.toFixed(1)} 小时`;
        }
        const winRate = totalGames > 0 ? `${(lifetimeStats.winRate * 100).toFixed(1)}%` : '--';
        const accuracy = lifetimeStats.totalShots > 0 ? `${(lifetimeStats.accuracy * 100).toFixed(1)}%` : '--';
        const favoriteWeapons = lifetimeStats.favoriteWeapons || [];
        const lastSession = lifetimeStats.lastSession;
        const totalScore = lifetimeStats.totalScore || 0;

        const achievementsConfig = getAchievementsConfig(lifetimeStats);

        const unlockedAchievements = achievementsConfig.filter(a => a.unlocked);
        const achievementsHTML = unlockedAchievements.length > 0
            ? unlockedAchievements.map(a => `
                <div class="achievement-item" title="${a.description}">
                    <div class="achievement-icon">${a.icon}</div>
                    <div class="achievement-name">${a.name}</div>
                </div>
            `).join('')
            : `
                <div class="empty-stats" style="padding: 12px;">
                    暂无成就<br>
                    <span style="font-size: 0.8rem; margin-top: 8px; display: block;">开始游戏以解锁你的第一枚勋章</span>
                </div>
            `;

        const weaponStatsHTML = favoriteWeapons.length > 0
            ? favoriteWeapons.map(weapon => `
                <div class="weapon-item">
                    <div>
                        <div class="weapon-name">${weapon.name || weapon.id}</div>
                        <div class="weapon-stat">🎯 击杀 ${weapon.kills || 0} · 命中率 ${(weapon.accuracy ? (weapon.accuracy * 100).toFixed(1) : '0.0')}%</div>
                    </div>
                    <div class="weapon-stat">得分 ${weapon.score?.toLocaleString() || 0}</div>
                </div>
            `).join('')
            : `
                <div class="empty-stats">
                    暂无武器统计数据<br>
                    <span style="font-size: 0.8rem; margin-top: 8px; display: block;">开始游戏后将显示最常用武器</span>
                </div>
            `;

        const recentMatchHTML = lastSession
            ? `
                <div class="recent-match">
                    <div class="recent-result ${lastSession.result === 'extracted' ? 'win' : 'defeat'}">
                        ${lastSession.result === 'extracted' ? '✅ 成功撤离' : '💀 阵亡' }
                    </div>
                    <div class="recent-row">
                        <span>得分</span>
                        <span>${(lastSession.finalScore || 0).toLocaleString()}</span>
                    </div>
                    <div class="recent-row">
                        <span>击杀</span>
                        <span>${lastSession.kills || 0}</span>
                    </div>
                    <div class="recent-row">
                        <span>时长</span>
                        <span>${lastSession.duration ? `${(lastSession.duration / 60).toFixed(1)} 分钟` : '--'}</span>
                    </div>
                    <div class="recent-row timestamp">
                        ${lastSession.timestamp ? new Date(lastSession.timestamp).toLocaleString() : ''}
                    </div>
                </div>
            `
            : `
                <div class="empty-stats" style="padding: 12px;">
                    暂无战绩数据
                </div>
            `;
        
        // 生成个人信息HTML
        const personalInfoHTML = `
            <style>
                .personal-info-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 20px;
                }
                .personal-avatar {
                    width: 80px;
                    height: 80px;
                    background: linear-gradient(135deg, #eab308, #f59e0b);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 2rem;
                    color: #1f2937;
                    margin-bottom: 20px;
                    box-shadow: 0 4px 20px rgba(234, 179, 8, 0.3);
                }
                .personal-name {
                    font-size: 1.8rem;
                    font-weight: 600;
                    color: #eab308;
                    margin-bottom: 8px;
                    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
                    display: inline-flex;
                    align-items: center;
                    position: relative;
                }
                .personal-rename-btn {
                    position: absolute;
                    right: -14px;
                    top: 50%;
                    transform: translateY(-50%);
                    padding: 0;
                    border-radius: 4px;
                    border: none;
                    background: transparent;
                    color: #6b7280;
                    font-size: 0.8rem;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                .personal-rename-btn:hover {
                    color: #e5e7eb;
                    background: rgba(17, 24, 39, 0.4);
                }
                .personal-id {
                    font-size: 0.9rem;
                    color: #9ca3af;
                    margin-bottom: 24px;
                    font-family: 'Courier New', monospace;
                }
                .personal-id-value {
                    user-select: text;
                    cursor: text;
                }
                .personal-stats {
                    width: 100%;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                    margin-bottom: 24px;
                }
                .stat-card {
                    background: rgba(55, 65, 81, 0.3);
                    border: 1px solid #374151;
                    border-radius: 8px;
                    padding: 16px;
                    text-align: center;
                    transition: all 0.2s ease;
                }
                .stat-card:hover {
                    background: rgba(55, 65, 81, 0.5);
                    border-color: #eab308;
                    transform: translateY(-2px);
                }
                .personal-info-container .stat-label {
                    font-size: 0.9rem;
                    color: #9ca3af;
                    margin-bottom: 8px;
                }
                .personal-info-container .stat-value {
                    font-size: 1.4rem;
                    font-weight: 600;
                    color: #f3f4f6;
                }
                .personal-info-container .stat-value.credit {
                    color: #eab308;
                }
                .personal-section {
                    width: 100%;
                    margin-bottom: 20px;
                }
                .section-title {
                    font-size: 1.1rem;
                    font-weight: 600;
                    color: #eab308;
                    margin-bottom: 12px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .section-content {
                    background: rgba(55, 65, 81, 0.2);
                    border: 1px solid #374151;
                    border-radius: 8px;
                    padding: 16px;
                }
                .weapon-stats {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .weapon-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 12px;
                    background: rgba(55, 65, 81, 0.3);
                    border-radius: 6px;
                    border: 1px solid #4b5563;
                }
                .weapon-name {
                    color: #f3f4f6;
                    font-weight: 500;
                }
                .weapon-stat {
                    color: #9ca3af;
                    font-size: 0.9rem;
                }
                .empty-stats {
                    color: #6b7280;
                    font-style: italic;
                    text-align: center;
                    padding: 20px;
                }
                .recent-match {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .recent-result {
                    font-weight: 600;
                    color: #f3f4f6;
                }
                .recent-result.win {
                    color: #34d399;
                }
                .recent-result.defeat {
                    color: #f87171;
                }
                .recent-row {
                    display: flex;
                    justify-content: space-between;
                    color: #d1d5db;
                    font-size: 0.95rem;
                    border-bottom: 1px solid rgba(55, 65, 81, 0.6);
                    padding-bottom: 4px;
                }
                .recent-row.timestamp {
                    border: none;
                    font-size: 0.85rem;
                    color: #9ca3af;
                    justify-content: flex-end;
                    padding-top: 6px;
                }
                .achievement-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                }
                .achievement-item {
                    aspect-ratio: 1;
                    background: rgba(55, 65, 81, 0.3);
                    border: 1px solid #4b5563;
                    border-radius: 8px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 12px;
                    transition: all 0.2s ease;
                }
                .achievement-item:hover {
                    background: rgba(55, 65, 81, 0.5);
                    border-color: #eab308;
                }
                .achievement-icon {
                    font-size: 1.5rem;
                    margin-bottom: 4px;
                }
                .achievement-name {
                    font-size: 0.8rem;
                    color: #d1d5db;
                    text-align: center;
                }
                .recover-account-btn {
                    margin-top: 4px;
                    align-self: stretch;
                    padding: 8px 14px;
                    border-radius: 999px;
                    border: 1px solid #4b5563;
                    background: rgba(31, 41, 55, 0.9);
                    color: #e5e7eb;
                    font-weight: 500;
                    cursor: pointer;
                    font-size: 0.85rem;
                    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.5);
                    transition: all 0.15s ease;
                }
                .recover-account-btn:hover {
                    border-color: #eab308;
                    color: #eab308;
                    background: rgba(17, 24, 39, 0.95);
                    transform: translateY(-1px);
                }
                .recover-account-btn:active {
                    transform: translateY(0);
                    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.7);
                }
            </style>
            <div class="personal-info-container">
                <div class="personal-avatar">👤</div>
                <div class="personal-name">
                    <span>${userData.nickname || 'Player'}</span>
                    <button id="personal-rename-btn" class="personal-rename-btn" title="修改名称">🖊</button>
                </div>
                <div class="personal-id">ID: <span class="personal-id-value">${localStorage.getItem('tacops_user_id') || 'Unknown'}</span></div>
                
                <div class="personal-stats">
                    <div class="stat-card">
                        <div class="stat-label">💰 Credit</div>
                        <div class="stat-value credit">${userData.credit?.toLocaleString() || 0}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">⏱️ 游戏时长</div>
                        <div class="stat-value">${displayHours}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">🎮 累计对局</div>
                        <div class="stat-value">${totalGames.toLocaleString()}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">🎯 总击杀</div>
                        <div class="stat-value">${totalKills.toLocaleString()}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">🎯 命中率</div>
                        <div class="stat-value">${accuracy}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">🏆 总分</div>
                        <div class="stat-value">${totalScore.toLocaleString()}</div>
                    </div>
                </div>
                
                <div class="personal-section">
                    <div class="section-title">
                        <span>🔫</span>
                        <span>武器统计</span>
                    </div>
                    <div class="section-content">
                        <div class="weapon-stats">
                            ${weaponStatsHTML}
                        </div>
                    </div>
                </div>

                <div class="personal-section">
                    <div class="section-title">
                        <span>📜</span>
                        <span>最近战绩</span>
                    </div>
                    <div class="section-content">
                        ${recentMatchHTML}
                    </div>
                </div>

                <div class="personal-section">
                    <div class="section-title">
                        <span>🏅</span>
                        <span>成就徽章</span>
                    </div>
                    <div class="section-content">
                        <div class="achievement-grid">
                            ${achievementsHTML}
                        </div>
                    </div>
                </div>
                <button id="recover-account-btn" class="recover-account-btn">找回账号</button>
            </div>
        `;
        
        // 更新弹窗内容
        const contentEl = document.querySelector('.modal-content');
        if (contentEl) contentEl.innerHTML = personalInfoHTML;

        const personalRenameBtn = document.getElementById('personal-rename-btn');
        if (personalRenameBtn) {
            personalRenameBtn.addEventListener('click', () => {
                const personalModalOverlay = document.querySelector('.modal-overlay');
                if (personalModalOverlay && personalModalOverlay.parentNode) {
                    personalModalOverlay.parentNode.removeChild(personalModalOverlay);
                }

                const overlay = document.getElementById('rename-overlay');
                const input = document.getElementById('rename-input');
                const cancelBtn = document.getElementById('rename-cancel');
                if (overlay) overlay.style.display = 'flex';
                if (cancelBtn) cancelBtn.style.display = '';
                if (input) {
                    input.value = state.playerName || '';
                    input.focus();
                    input.select();
                }
            });
        }

        const recoverBtn = document.getElementById('recover-account-btn');
        if (recoverBtn) {
            recoverBtn.addEventListener('click', () => {
                const currentId = localStorage.getItem('tacops_user_id') || '';
                const recoverContent = `
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <div style="font-size:0.9rem;color:#d1d5db;">
                            请输入要找回的账号 ID：
                        </div>
                        <input id="recover-account-input" type="text" value="${currentId}"
                            style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #4b5563;background:#030712;color:#e5e7eb;font-size:0.9rem;outline:none;" />
                        <div id="recover-account-error" style="min-height:1.2em;font-size:0.8rem;color:#f97316;"></div>
                        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
                            <button id="recover-account-cancel" style="padding:6px 12px;border-radius:6px;border:1px solid #4b5563;background:transparent;color:#e5e7eb;font-size:0.85rem;cursor:pointer;">取消</button>
                            <button id="recover-account-confirm" style="padding:6px 12px;border-radius:6px;border:1px solid #22c55e;background:#22c55e;color:#022c22;font-size:0.85rem;font-weight:600;cursor:pointer;">确认切换</button>
                        </div>
                        <div style="font-size:0.8rem;color:#9ca3af;margin-top:4px;">
                            提示：账号 ID 为在个人信息面板中显示的 ID 字符串，切换后将使用该账号的所有数据。
                        </div>
                    </div>
                `;

                const closeRecoverModal = showModal('找回账号', recoverContent, {
                    width: '420px',
                    height: '260px'
                });

                setTimeout(() => {
                    const inputEl = document.getElementById('recover-account-input');
                    const cancelEl = document.getElementById('recover-account-cancel');
                    const confirmEl = document.getElementById('recover-account-confirm');
                    const errorEl = document.getElementById('recover-account-error');

                    if (!inputEl || !cancelEl || !confirmEl) return;

                    inputEl.focus();
                    inputEl.select();

                    cancelEl.addEventListener('click', () => {
                        closeRecoverModal();
                    });

                    const doRecover = async () => {
                        const targetId = inputEl.value.trim();
                        if (!targetId) {
                            if (errorEl) errorEl.textContent = '请输入有效的账号 ID';
                            return;
                        }

                        if (confirmEl) {
                            confirmEl.disabled = true;
                            confirmEl.textContent = '查找中...';
                        }
                        if (errorEl) errorEl.textContent = '';

                        try {
                            const user = await getUserDataByUUID(targetId);
                            if (!user) {
                                if (errorEl) errorEl.textContent = '未找到该账号，请确认 ID 是否正确。';
                                return;
                            }

                            localStorage.setItem('tacops_user_id', targetId);
                            closeRecoverModal();
                            alert('账号已切换，即将刷新以载入新账号数据。');
                            window.location.reload();
                        } catch (e) {
                            console.error('账号找回失败:', e);
                            if (errorEl) errorEl.textContent = '查找过程中出现错误，请稍后重试。';
                        } finally {
                            if (confirmEl) {
                                confirmEl.disabled = false;
                                confirmEl.textContent = '确认切换';
                            }
                        }
                    };

                    confirmEl.addEventListener('click', () => {
                        doRecover();
                    });

                    inputEl.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            doRecover();
                        }
                    });
                }, 0);
            });
        }
        
    } catch (error) {
        console.error('加载个人信息失败:', error);
        const errorContent = `
            <div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #ef4444;">
                <div style="text-align: center;">
                    <div style="font-size: 2rem; margin-bottom: 16px;">❌</div>
                    <div>加载个人信息失败</div>
                    <div style="font-size: 0.9rem; margin-top: 8px; color: #9ca3af;">请稍后重试</div>
                </div>
            </div>
        `;
        // 更新弹窗内容
        const contentEl = document.querySelector('.modal-content');
        if (contentEl) contentEl.innerHTML = errorContent;
    }
}

// 显示排行榜
export async function showLeaderboard() {
    // 显示加载状态
    const loadingContent = `
        <div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #9ca3af;">
            <div style="text-align: center;">
                <div style="font-size: 2rem; margin-bottom: 16px;">🏆</div>
                <div>正在加载排行榜数据...</div>
            </div>
        </div>
    `;
    
    const closeModal = showModal('排行榜', loadingContent, {
        width: '520px',
        height: '620px'
    });
    
    // 榜单类型状态
    let currentType = 'credit'; // 'credit' | 'bestScore' | 'totalKills'
    // 数据缓存
    let cachedData = {
        credit: null,
        bestScore: null,
        totalKills: null
    };
    
    // 并行拉取三个榜单数据
    try {
        const [creditData, bestScoreData, totalKillsData] = await Promise.all([
            getLeaderboard(50),
            getLeaderboardByBestScore(50),
            getLeaderboardByTotalKills(50)
        ]);
        cachedData.credit = creditData;
        cachedData.bestScore = bestScoreData;
        cachedData.totalKills = totalKillsData;
    } catch (error) {
        console.error('❌ 拉取榜单数据失败:', error);
        const errorContent = `
            <div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #ef4444;">
                <div style="text-align: center;">
                    <div style="font-size: 2rem; margin-bottom: 16px;">❌</div>
                    <div>加载排行榜失败</div>
                    <div style="font-size: 0.9rem; margin-top: 8px; color: #9ca3af;">请稍后重试</div>
                </div>
            </div>
        `;
        const contentEl = document.querySelector('.modal-content');
        if (contentEl) contentEl.innerHTML = errorContent;
        return;
    }
    
    // 纯渲染函数（从缓存读取数据
    function renderLeaderboard(type) {
        currentType = type;
        const data = cachedData[type];
        
        if (!data || data.length === 0) {
            const emptyContent = `
                <div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #9ca3af;">
                    <div style="text-align: center;">
                        <div style="font-size: 2rem; margin-bottom: 16px;">📭</div>
                        <div>暂无排行榜数据</div>
                    </div>
                </div>
            `;
            const contentEl = document.querySelector('.modal-content');
            if (contentEl) contentEl.innerHTML = emptyContent;
            return;
        }
        
        // 根据类型决定标题和显示字段
        let title;
        let valueKey;
        let valueSuffix;
        switch (type) {
            case 'bestScore':
                title = '🏆 最高分数排行榜';
                valueKey = 'bestScore';
                valueSuffix = '分';
                break;
            case 'totalKills':
                title = '🏆 总击杀排行榜';
                valueKey = 'totalKills';
                valueSuffix = '击杀';
                break;
            default:
                title = '🏆 信用点排行榜';
                valueKey = 'credit';
                valueSuffix = '💰';
        }
        
        // 生成排行榜HTML（含切换按钮）
        const leaderboardHTML = `
            <style>
                .leaderboard-tabs {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 16px;
                    border-bottom: 1px solid #374151;
                    padding-bottom: 12px;
                }
                .leaderboard-tab {
                    padding: 6px 16px;
                    background: transparent;
                    border: 1px solid #444;
                    color: #9ca3af;
                    font-size: 0.85rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    cursor: pointer;
                    transition: all 0.2s;
                    border-radius: 4px;
                }
                .leaderboard-tab:hover {
                    border-color: #eab308;
                    color: #eab308;
                }
                .leaderboard-tab.active {
                    background: #eab308;
                    color: #000;
                    border-color: #eab308;
                }
                .leaderboard-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .leaderboard-item {
                    display: flex;
                    align-items: center;
                    padding: 12px 16px;
                    margin-bottom: 8px;
                    background: rgba(55, 65, 81, 0.3);
                    border-radius: 6px;
                    border: 1px solid #374151;
                    transition: all 0.2s ease;
                    cursor: pointer;
                }
                .leaderboard-item:hover {
                    background: rgba(55, 65, 81, 0.5);
                    border-color: #eab308;
                    transform: translateX(4px);
                }
                .leaderboard-rank {
                    width: 40px;
                    text-align: center;
                    font-weight: 600;
                    font-size: 1.1rem;
                }
                .leaderboard-rank.gold {
                    color: #fbbf24;
                    text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
                }
                .leaderboard-rank.silver {
                    color: #e5e7eb;
                    text-shadow: 0 0 10px rgba(229, 231, 235, 0.5);
                }
                .leaderboard-rank.bronze {
                    color: #f97316;
                    text-shadow: 0 0 10px rgba(249, 115, 22, 0.5);
                }
                .leaderboard-medal {
                    margin-right: 8px;
                    font-size: 1.2rem;
                }
                .leaderboard-nickname {
                    flex: 1;
                    margin-left: 16px;
                    font-weight: 500;
                    color: #f3f4f6;
                }
                .leaderboard-value {
                    font-weight: 600;
                    color: #eab308;
                    font-size: 1.1rem;
                }
                .leaderboard-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0 16px 16px 16px;
                    border-bottom: 1px solid #374151;
                    margin-bottom: 16px;
                }
                .leaderboard-title {
                    color: #eab308;
                    font-size: 1.1rem;
                    font-weight: 600;
                }
                .leaderboard-count {
                    color: #9ca3af;
                    font-size: 0.9rem;
                }
            </style>
            <div class="leaderboard-tabs">
                <button class="leaderboard-tab ${type === 'credit' ? 'active' : ''}" data-type="credit">信用点</button>
                <button class="leaderboard-tab ${type === 'bestScore' ? 'active' : ''}" data-type="bestScore">最高分数</button>
                <button class="leaderboard-tab ${type === 'totalKills' ? 'active' : ''}" data-type="totalKills">总击杀</button>
            </div>
            <div class="leaderboard-header">
                <div class="leaderboard-title">${title}</div>
                <div class="leaderboard-count">共 ${data.length} 位玩家</div>
            </div>
            <ul class="leaderboard-list">
                ${data.map((player, index) => {
                    const rank = index + 1;
                    let rankClass = '';
                    let medal = '';
                    
                    if (rank === 1) {
                        rankClass = 'gold';
                        medal = '🥇';
                    } else if (rank === 2) {
                        rankClass = 'silver';
                        medal = '🥈';
                    } else if (rank === 3) {
                        rankClass = 'bronze';
                        medal = '🥉';
                    } else {
                        medal = `${rank}.`;
                    }
                    
                    const value = player[valueKey] || 0;
                    
                    return `
                        <li class="leaderboard-item" data-uuid="${player.uuid}">
                            <div class="leaderboard-rank ${rankClass}">
                                <span class="leaderboard-medal">${medal}</span>
                            </div>
                            <div class="leaderboard-nickname">${player.nickname || 'Anonymous'}</div>
                            <div class="leaderboard-value">${typeof value === 'number' ? value.toLocaleString() : value} ${valueSuffix}</div>
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
        
        // 更新弹窗内容
        const contentEl = document.querySelector('.modal-content');
        if (contentEl) contentEl.innerHTML = leaderboardHTML;
        
        // 绑定切换按钮事件
        document.querySelectorAll('.leaderboard-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const newType = btn.dataset.type;
                if (newType !== currentType) {
                    renderLeaderboard(newType);
                }
            });
        });
        
        // 绑定排行榜项点击事件
        document.querySelectorAll('.leaderboard-item').forEach(item => {
            item.addEventListener('click', () => {
                const uuid = item.dataset.uuid;
                console.log('🖱️ 点击排行榜项，uuid:', uuid, 'nickname:', item.querySelector('.leaderboard-nickname')?.textContent);
                if (uuid) {
                    // 先关闭排行榜弹窗，再打开个人信息
                    closeModal();
                    showOtherUserInfo(uuid);
                } else {
                    console.error('❌ 排行榜项没有 uuid');
                }
            });
        });
    }
    
    // 初始渲染 Credit 榜单
    renderLeaderboard('credit');
}

// 显示更新日志
export function showChangelog() {
    const content = `
        <style>
            .changelog-entry {
                margin-bottom: 24px;
                padding-bottom: 20px;
                border-bottom: 1px solid #374151;
            }
            .changelog-entry:last-child {
                margin-bottom: 0;
                border-bottom: none;
            }
            .changelog-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }
            .changelog-version {
                color: #eab308;
                font-weight: 600;
                font-size: 1.1rem;
                background: rgba(234, 179, 8, 0.1);
                padding: 4px 12px;
                border-radius: 4px;
                border: 1px solid rgba(234, 179, 8, 0.3);
            }
            .changelog-date {
                color: #9ca3af;
                font-size: 0.9rem;
            }
            .changelog-title {
                color: #f3f4f6;
                font-size: 1.2rem;
                font-weight: 500;
                margin-bottom: 12px;
            }
            .changelog-changes {
                margin: 0;
                padding-left: 20px;
                color: #d1d5db;
            }
            .changelog-changes li {
                margin-bottom: 6px;
                line-height: 1.5;
            }
            .changelog-changes li:last-child {
                margin-bottom: 0;
            }
        </style>
        ${getChangelogHTML()}
    `;
    
    return showModal('更新日志', content, {
        width: '600px',
        height: '700px'
    });
}

// 信息按钮事件处理
function initInfoButtonsEvents() {
    const personalBtn = document.getElementById('info-btn-personal');
    const leaderboardBtn = document.getElementById('info-btn-leaderboard');
    const changelogBtn = document.getElementById('info-btn-changelog');

    if (personalBtn) {
        personalBtn.addEventListener('click', () => {
            console.log('个人信息按钮被点击');
            showPersonalInfo();
        });
    }

    if (leaderboardBtn) {
        leaderboardBtn.addEventListener('click', () => {
            console.log('排行榜按钮被点击');
            showLeaderboard();
        });
    }

    if (changelogBtn) {
        changelogBtn.addEventListener('click', () => {
            console.log('更新日志按钮被点击');
            showChangelog();
        });
    }
}

// 显示通知的辅助函数
function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    container.appendChild(notification);
    
    // 3秒后自动移除
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// 设置界面相关功能
let originalMouseSensitivity = 1.0;
let originalShadowQuality = 'high';
let originalAnisoQuality = 'max';
let originalShowPerfDetails = false;
let originalRenderDistance = 'ultra';
let originalCrosshairStyle = 'pixel';

function showSettingsMenu() {
    const settingsOverlay = document.getElementById('settings-overlay');
    const pauseOverlay = document.getElementById('pause-overlay');
    
    if (!settingsOverlay) return;
    
    // 保存当前鼠标灵敏度
    originalMouseSensitivity = state.mouseSensitivity || 1.0;
    // 保存当前阴影质量和各向异性设置
    originalShadowQuality = state.shadowQuality || 'high';
    originalAnisoQuality = state.anisoQuality || 'max';
    originalShowPerfDetails = (state.showPerfDetails !== undefined) ? state.showPerfDetails : true;
    originalRenderDistance = state.renderDistance || 'ultra';
    originalCrosshairStyle = state.crosshairStyle || 'pixel';
    
    // 设置滑块当前值
    const slider = document.getElementById('mouse-sensitivity-slider');
    const valueDisplay = document.getElementById('mouse-sensitivity-value');
    if (slider && valueDisplay) {
        slider.value = originalMouseSensitivity;
        valueDisplay.textContent = originalMouseSensitivity.toFixed(1);
        
        // 滑块事件监听
        slider.oninput = () => {
            valueDisplay.textContent = parseFloat(slider.value).toFixed(1);
        };
    }

    // 初始化性能详情复选框
    const perfToggle = document.getElementById('perf-details-toggle');
    if (perfToggle) {
        perfToggle.checked = !!originalShowPerfDetails;
    }

    // 阴影质量下拉框
    const shadowQualitySelect = document.getElementById('shadow-quality-select');
    if (shadowQualitySelect) {
        shadowQualitySelect.value = originalShadowQuality;
    }

    // 渲染距离下拉框
    const renderDistanceSelect = document.getElementById('render-distance-select');
    if (renderDistanceSelect) {
        renderDistanceSelect.value = originalRenderDistance;
    }

    // 准星样式下拉框
    const crosshairStyleSelect = document.getElementById('crosshair-style-select');
    if (crosshairStyleSelect) {
        crosshairStyleSelect.value = originalCrosshairStyle;
    }

    // 各向异性过滤质量
    const anisoSelect = document.getElementById('aniso-quality-select');
    if (anisoSelect) {
        anisoSelect.value = originalAnisoQuality;
    }
    
    // 绑定按钮事件
    const applyBtn = document.getElementById('settings-apply-btn');
    const cancelBtn = document.getElementById('settings-cancel-btn');
    
    if (applyBtn) {
        applyBtn.onclick = applySettings;
    }
    if (cancelBtn) {
        cancelBtn.onclick = cancelSettings;
    }
    
    // 显示设置界面，隐藏暂停菜单
    settingsOverlay.style.display = 'block';
    if (pauseOverlay) {
        pauseOverlay.style.display = 'none';
    }
    
    // 暂停游戏
    if (window.pauseGameFromMenu) {
        window.pauseGameFromMenu();
    }
}

function applySettings() {
    const slider = document.getElementById('mouse-sensitivity-slider');
    if (slider) {
        state.mouseSensitivity = parseFloat(slider.value);
        console.log('设置已应用：鼠标灵敏度 =', state.mouseSensitivity);
    }

    const renderDistanceSelect = document.getElementById('render-distance-select');
    if (renderDistanceSelect) {
        state.renderDistance = renderDistanceSelect.value;

        if (state.scene && state.camera && state.scene.fog) {
            let fogFar = 500;
            let camFar = 900;
            const mode = state.renderDistance || 'far';
            if (mode === 'near') {
                fogFar = 200; camFar = 400;
            } else if (mode === 'medium') {
                fogFar = 300; camFar = 650;
            } else if (mode === 'far') {
                fogFar = 500; camFar = 900;
            } else if (mode === 'ultra') {
                fogFar = 700; camFar = 1300;
            }
            state.scene.fog.near = 10;
            state.scene.fog.far = fogFar;
            state.camera.near = 0.1;
            state.camera.far = camFar;
            state.camera.updateProjectionMatrix();
        }
    }

    // 应用阴影质量（同时决定是否启用阴影）
    const shadowQualitySelect = document.getElementById('shadow-quality-select');
    if (shadowQualitySelect) {
        state.shadowQuality = shadowQualitySelect.value;
        const enabled = state.shadowQuality !== 'off';
        state.shadowsEnabled = enabled;
        if (state.renderer) {
            state.renderer.shadowMap.enabled = enabled;
        }
        if (state.dirLight) {
            state.dirLight.castShadow = enabled;
        }
        if (state.dirLight && state.dirLight.shadow && state.dirLight.shadow.mapSize) {
            let size = 4096;
            if (state.shadowQuality === 'medium') size = 2048;
            state.dirLight.shadow.mapSize.set(size, size);
            if (state.dirLight.shadow.map) {
                state.dirLight.shadow.map.dispose();
                state.dirLight.shadow.map = null;
            }
        }
    }

    // 应用各向异性过滤质量（立即作用于关键纹理）
    const anisoSelect = document.getElementById('aniso-quality-select');
    if (anisoSelect && state.renderer) {
        state.anisoQuality = anisoSelect.value;
        const maxAniso = state.renderer.capabilities.getMaxAnisotropy();
        let anisoValue = 1;
        if (state.anisoQuality === 'medium') {
            anisoValue = Math.max(1, Math.floor(maxAniso / 2));
        } else if (state.anisoQuality === 'max') {
            anisoValue = maxAniso;
        }
        const texTargets = [
            state.mats.road?.map,
            state.mats.sidewalk?.map,
            state.mats.floor?.map
        ];
        texTargets.forEach(tex => {
            if (tex) {
                tex.anisotropy = anisoValue;
                tex.needsUpdate = true;
            }
        });
        console.log('设置已应用：各向异性过滤 =', state.anisoQuality, `(值=${anisoValue})`);
    }
    
    // 应用性能详情开关
    const perfToggle = document.getElementById('perf-details-toggle');
    if (perfToggle) {
        state.showPerfDetails = perfToggle.checked;
    }

    // 应用准星样式
    const crosshairStyleSelect = document.getElementById('crosshair-style-select');
    if (crosshairStyleSelect) {
        updateCrosshairStyle(crosshairStyleSelect.value);
    }

    // 保存设置到数据库
    const settingsToSave = {
        mouseSensitivity: state.mouseSensitivity,
        shadowQuality: state.shadowQuality,
        anisoQuality: state.anisoQuality,
        showPerfDetails: state.showPerfDetails,
        renderDistance: state.renderDistance || 'ultra',
        crosshairStyle: state.crosshairStyle
    };
    
    updateSetting(settingsToSave).catch(error => {
        console.error('❌ 设置保存失败:', error);
    });
    
    closeSettingsMenu();
}

function cancelSettings() {
    // 恢复原始设置
    state.mouseSensitivity = originalMouseSensitivity;
    console.log('设置已取消：恢复鼠标灵敏度 =', originalMouseSensitivity);

    // 恢复原始阴影质量和开关
    state.shadowQuality = originalShadowQuality;
    const enabled = state.shadowQuality !== 'off';
    state.shadowsEnabled = enabled;
    if (state.renderer) {
        state.renderer.shadowMap.enabled = enabled;
    }
    if (state.dirLight) {
        state.dirLight.castShadow = enabled;
        if (state.dirLight.shadow && state.dirLight.shadow.mapSize) {
            let size = 4096;
            if (state.shadowQuality === 'medium') size = 2048;
            state.dirLight.shadow.mapSize.set(size, size);
        }
    }

    // 恢复性能详情开关
    state.showPerfDetails = originalShowPerfDetails;

    // 恢复准星样式
    updateCrosshairStyle(originalCrosshairStyle);
    
    closeSettingsMenu();
}

function closeSettingsMenu() {
    const settingsOverlay = document.getElementById('settings-overlay');
    const pauseOverlay = document.getElementById('pause-overlay');
    
    if (settingsOverlay) {
        settingsOverlay.style.display = 'none';
    }
    
    // 显示暂停菜单
    if (pauseOverlay) {
        pauseOverlay.style.display = 'flex';
    }
}

// 查看他人信息（隐藏敏感操作）
export async function showOtherUserInfo(uuid) {
    // 显示加载状态
    const loadingContent = `
        <div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #9ca3af;">
            <div style="text-align: center;">
                <div style="font-size: 2rem; margin-bottom: 16px;">👤</div>
                <div>正在加载用户信息...</div>
            </div>
        </div>
    `;
    
    const modalRef = showModal('用户信息', loadingContent, {
        width: '500px',
        height: '600px'
    });
    
    // 直接从返回值获取 contentEl，绝对可靠
    const contentEl = modalRef.contentEl;
    console.log('✅ 从 modalRef 获取 contentEl:', contentEl);
    
    try {
        console.log('🔍 开始加载他人信息，uuid:', uuid);
        
        // 获取目标用户数据与长期统计
        const [userData, lifetimeStats] = await Promise.all([
            getUserDataByUUID(uuid),
            (async () => {
                const stats = await getLifetimeStatsByUUID(uuid);
                return stats || getDefaultLifetimeStats();
            })()
        ]);
        
        console.log('📊 他人信息获取结果:', { userData, lifetimeStats });

        if (!userData) {
            const errorContent = `
                <div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #ef4444;">
                    <div style="text-align: center;">
                        <div style="font-size: 2rem; margin-bottom: 16px;">❌</div>
                        <div>用户不存在</div>
                    </div>
                </div>
            `;
            contentEl.innerHTML = errorContent;
            return;
        }

        const totalGames = lifetimeStats.totalGames || 0;
        const totalWins = lifetimeStats.totalWins || 0;
        const totalKills = lifetimeStats.totalKills || 0;
        const totalSeconds = lifetimeStats.totalDuration || 0;
        const totalHours = totalSeconds / 3600;
        const totalMinutes = totalSeconds / 60;
        let displayHours;
        if (totalSeconds <= 0) {
            displayHours = '--';
        } else if (totalHours < 1) {
            displayHours = `${Math.max(1, Math.round(totalMinutes))} 分钟`;
        } else {
            displayHours = `${totalHours.toFixed(1)} 小时`;
        }
        const winRate = totalGames > 0 ? `${(lifetimeStats.winRate * 100).toFixed(1)}%` : '--';
        const accuracy = lifetimeStats.totalShots > 0 ? `${(lifetimeStats.accuracy * 100).toFixed(1)}%` : '--';
        const favoriteWeapons = lifetimeStats.favoriteWeapons || [];
        const lastSession = lifetimeStats.lastSession;
        const totalScore = lifetimeStats.totalScore || 0;

        const achievementsConfig = getAchievementsConfig(lifetimeStats);
        const unlockedAchievements = achievementsConfig.filter(a => a.unlocked);

        const achievementsHTML = unlockedAchievements.length > 0 
            ? unlockedAchievements.map(achievement => `
                <div class="achievement-item" title="${achievement.description}">
                    <div class="achievement-icon">${achievement.icon}</div>
                    <div class="achievement-name">${achievement.name}</div>
                </div>
            `).join('')
            : '<div class="empty-stats">暂无解锁成就</div>';

        const weaponStatsHTML = favoriteWeapons.length > 0
            ? favoriteWeapons.slice(0, 3).map(weapon => `
                <div class="weapon-stat-item">
                    <div class="weapon-name">${weapon.name || weapon.id}</div>
                    <div class="weapon-stat">击杀: ${weapon.kills || 0} | 伤害: ${Math.round(weapon.damage || 0)}</div>
                </div>
            `).join('')
            : '<div class="empty-stats">暂无武器数据</div>';

        const recentMatchHTML = lastSession ? `
            <div class="recent-match">
                <div class="recent-result ${lastSession.result === 'extracted' ? 'win' : 'defeat'}">
                    ${lastSession.result === 'extracted' ? '✅ 成功撤离' : '💀 阵亡' }
                </div>
                <div class="recent-row">
                    <span>得分</span>
                    <span>${( lastSession.finalScore || 0).toLocaleString()}</span>
                </div>
                <div class="recent-row">
                    <span>击杀</span>
                    <span>${lastSession.kills || 0}</span>
                </div>
                <div class="recent-row">
                    <span>时长</span>
                    <span>${lastSession.duration ? `${(lastSession.duration / 60).toFixed(1)} 分钟` : '--'}</span>
                </div>
                <div class="recent-row timestamp">
                    ${lastSession.timestamp ? new Date(lastSession.timestamp).toLocaleString() : ''}
                </div>
            </div>
        ` : '<div class="empty-stats">暂无最近战绩</div>';

        // 生成他人信息HTML（隐藏敏感按钮
        const otherUserInfoHTML = `
            <style>
                .personal-info-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 20px;
                }
                .personal-avatar {
                    width: 80px;
                    height: 80px;
                    background: linear-gradient(135deg, #eab308, #f59e0b);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 2rem;
                    color: #1f2937;
                    margin-bottom: 20px;
                    box-shadow: 0 4px 20px rgba(234, 179, 8, 0.3);
                }
                .personal-name {
                    font-size: 1.8rem;
                    font-weight: 600;
                    color: #eab308;
                    margin-bottom: 8px;
                    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
                }
                .personal-stats {
                    width: 100%;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                    margin-bottom: 24px;
                }
                .stat-card {
                    background: rgba(55, 65, 81, 0.3);
                    border: 1px solid #374151;
                    border-radius: 8px;
                    padding: 16px;
                    text-align: center;
                    transition: all 0.2s ease;
                }
                .stat-card:hover {
                    background: rgba(55, 65, 81, 0.5);
                    border-color: #eab308;
                    transform: translateY(-2px);
                }
                .stat-label {
                    font-size: 0.85rem;
                    color: #9ca3af;
                    margin-bottom: 4px;
                }
                .stat-value {
                    font-size: 1.4rem;
                    font-weight: 700;
                    color: #f3f4f6;
                }
                .stat-value.credit {
                    color: #eab308;
                }
                .personal-section {
                    width: 100%;
                    margin-bottom: 24px;
                }
                .section-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 1rem;
                    font-weight: 600;
                    color: #eab308;
                    margin-bottom: 12px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #374151;
                }
                .section-content {
                    background: rgba(31, 41, 55, 0.3);
                    border: 1px solid #374151;
                    border-radius: 8px;
                    padding: 16px;
                }
                .weapon-stats {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .weapon-stat-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 12px;
                    background: rgba(55, 65, 81, 0.3);
                    border-radius: 6px;
                    transition: background 0.2s;
                }
                .weapon-stat-item:hover {
                    background: rgba(75, 85, 99, 0.4);
                }
                .weapon-name {
                    font-weight: 600;
                    color: #f3f4f6;
                }
                .weapon-stat {
                    color: #9ca3af;
                    font-size: 0.9rem;
                }
                .empty-stats {
                    color: #6b7280;
                    font-style: italic;
                    text-align: center;
                    padding: 20px;
                }
                .recent-match {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .recent-result {
                    font-weight: 600;
                    color: #f3f4f6;
                }
                .recent-result.win {
                    color: #34d399;
                }
                .recent-result.defeat {
                    color: #f87171;
                }
                .recent-row {
                    display: flex;
                    justify-content: space-between;
                    color: #d1d5db;
                    font-size: 0.95rem;
                    border-bottom: 1px solid rgba(55, 65, 81, 0.6);
                    padding-bottom: 4px;
                }
                .recent-row.timestamp {
                    border: none;
                    font-size: 0.85rem;
                    color: #9ca3af;
                    justify-content: flex-end;
                    padding-top: 6px;
                }
                .achievement-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                }
                .achievement-item {
                    aspect-ratio: 1;
                    background: rgba(55, 65, 81, 0.3);
                    border: 1px solid #4b5563;
                    border-radius: 8px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 12px;
                    transition: all 0.2s ease;
                }
                .achievement-item:hover {
                    background: rgba(55, 65, 81, 0.5);
                    border-color: #eab308;
                }
                .achievement-icon {
                    font-size: 1.5rem;
                    margin-bottom: 4px;
                }
                .achievement-name {
                    font-size: 0.8rem;
                    color: #d1d5db;
                    text-align: center;
                }
            </style>
            <div class="personal-info-container">
                <div class="personal-avatar">👤</div>
                <div class="personal-name">
                    <span>${userData.nickname || 'Player'}</span>
                </div>
                
                <div class="personal-stats">
                    <div class="stat-card">
                        <div class="stat-label">💰 Credit</div>
                        <div class="stat-value credit">${userData.credit?.toLocaleString() || 0}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">⏱️ 游戏时长</div>
                        <div class="stat-value">${displayHours}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">🎮 累计对局</div>
                        <div class="stat-value">${totalGames.toLocaleString()}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">🎯 总击杀</div>
                        <div class="stat-value">${totalKills.toLocaleString()}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">🎯 命中率</div>
                        <div class="stat-value">${accuracy}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">🏆 总分</div>
                        <div class="stat-value">${totalScore.toLocaleString()}</div>
                    </div>
                </div>
                
                <div class="personal-section">
                    <div class="section-title">
                        <span>🔫</span>
                        <span>武器统计</span>
                    </div>
                    <div class="section-content">
                        <div class="weapon-stats">
                            ${weaponStatsHTML}
                        </div>
                    </div>
                </div>

                <div class="personal-section">
                    <div class="section-title">
                        <span>📜</span>
                        <span>最近战绩</span>
                    </div>
                    <div class="section-content">
                        ${recentMatchHTML}
                    </div>
                </div>

                <div class="personal-section">
                    <div class="section-title">
                        <span>🏅</span>
                        <span>成就徽章</span>
                    </div>
                    <div class="section-content">
                        <div class="achievement-grid">
                            ${achievementsHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // 更新弹窗内容
        console.log('🔄 准备更新 UI，contentEl:', contentEl, 'HTML 长度:', otherUserInfoHTML.length);
        contentEl.innerHTML = otherUserInfoHTML;
        console.log('✅ UI 更新完成');
        
    } catch (error) {
        console.error('加载他人信息失败:', error);
        const errorContent = `
            <div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #ef4444;">
                <div style="text-align: center;">
                    <div style="font-size: 2rem; margin-bottom: 16px;">❌</div>
                    <div>加载用户信息失败</div>
                    <div style="font-size: 0.9rem; margin-top: 8px; color: #9ca3af;">请稍后重试</div>
                </div>
            </div>
        `;
        contentEl.innerHTML = errorContent;
    }
}

// ================== 多人游戏专用 UI & 控制 ==================

// 已有的函数（updateMultiplayerHealthUI, setPlayerInputEnabled）保留

// 击杀提示（多人）：在屏幕中心短暂显示 Kill/Headshot
(() => {
    let killMarkerEl = null;
    function ensureKillMarker() {
        if (killMarkerEl) return killMarkerEl;
        killMarkerEl = document.createElement('div');
        killMarkerEl.id = 'mp-killmarker';
        killMarkerEl.style.position = 'fixed';
        killMarkerEl.style.top = '45%';
        killMarkerEl.style.left = '50%';
        killMarkerEl.style.transform = 'translate(-50%, -50%)';
        killMarkerEl.style.padding = '12px 18px';
        killMarkerEl.style.borderRadius = '10px';
        killMarkerEl.style.background = 'rgba(0,0,0,0.6)';
        killMarkerEl.style.color = '#fff';
        killMarkerEl.style.fontSize = '28px';
        killMarkerEl.style.fontWeight = '700';
        killMarkerEl.style.letterSpacing = '1px';
        killMarkerEl.style.pointerEvents = 'none';
        killMarkerEl.style.opacity = '0';
        killMarkerEl.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
        document.body.appendChild(killMarkerEl);
        return killMarkerEl;
    }

    window.showKillMarker = function(isHeadshot = false) {
        const el = ensureKillMarker();
        el.textContent = isHeadshot ? 'HEADSHOT' : 'KILL';
        el.style.opacity = '1';
        el.style.transform = 'translate(-50%, -50%) scale(1.05)';
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translate(-50%, -50%) scale(0.95)';
        }, 600);
    };
})();

// 多人游戏血量护甲UI更新
window.updateMultiplayerHealthUI = function() {
    const state = window.state || {};
    
    if (state.gameMode !== 'mp_arena') return;
    
    // 更新血量显示
    const hpEl = document.getElementById('health-val');
    if (hpEl) {
        hpEl.innerText = Math.floor(state.mpHp || 0);
    }
    
    // 更新护甲显示
    const armorEl = document.getElementById('armor-val');
    if (armorEl) {
        armorEl.innerText = Math.floor(state.mpArmor || 0) + ' / ' + (state.maxArmor || 50);
    }
    
    // 如果玩家死亡，显示复活提示
    if (state.mpAlive === false) {
        const respawnHintEl = document.getElementById('respawn-hint');
        if (!respawnHintEl) {
            const hint = document.createElement('div');
            hint.id = 'respawn-hint';
            hint.style.position = 'fixed';
            hint.style.top = '50%';
            hint.style.left = '50%';
            hint.style.transform = 'translate(-50%, -50%)';
            hint.style.color = '#ef4444';
            hint.style.fontSize = '24px';
            hint.style.fontWeight = 'bold';
            hint.style.textAlign = 'center';
            hint.style.pointerEvents = 'none';
            hint.style.zIndex = '10000';
            hint.innerHTML = '你已阵亡<br><span style="font-size: 16px; color: #9ca3af;">2秒后复活...</span>';
            document.body.appendChild(hint);
        }
    } else {
        // 移除复活提示
        const respawnHintEl = document.getElementById('respawn-hint');
        if (respawnHintEl && respawnHintEl.parentNode) {
            respawnHintEl.parentNode.removeChild(respawnHintEl);
        }
    }
};

// 禁用/启用玩家输入控制
window.setPlayerInputEnabled = function(enabled) {
    const state = window.state || {};
    
    if (enabled) {
        // 启用输入：移除死亡标记
        state.isInputDisabled = false;
        
        // 移除死亡遮罩（如果存在）
        const deathOverlay = document.getElementById('death-overlay');
        if (deathOverlay && deathOverlay.parentNode) {
            deathOverlay.parentNode.removeChild(deathOverlay);
        }
    } else {
        // 禁用输入：设置死亡标记
        state.isInputDisabled = true;
        
        // 添加死亡遮罩效果
        let deathOverlay = document.getElementById('death-overlay');
        if (!deathOverlay) {
            deathOverlay = document.createElement('div');
            deathOverlay.id = 'death-overlay';
            deathOverlay.style.position = 'fixed';
            deathOverlay.style.top = '0';
            deathOverlay.style.left = '0';
            deathOverlay.style.width = '100%';
            deathOverlay.style.height = '100%';
            deathOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            deathOverlay.style.pointerEvents = 'none';
            deathOverlay.style.zIndex = '9998';
            document.body.appendChild(deathOverlay);
        }
    }
};

