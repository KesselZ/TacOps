// 游戏结束结算界面模块
import { state } from './globals.js';

export class GameOverScreen {
    constructor() {
        this.isVisible = false;
        this.initElements();
    }

    initElements() {
        this.screen = document.getElementById('game-over-screen');
        this.resultTitle = document.getElementById('game-result');
        this.sessionEarnings = document.getElementById('session-earnings');
        
        // 简化的核心统计
        this.sessionKills = document.getElementById('session-kills');
        this.sessionDuration = document.getElementById('session-duration');
        this.damageDealt = document.getElementById('session-damage');
        this.headshotRate = document.getElementById('session-headshot-rate');
        
        this.leaveBtn = document.getElementById('leave-game-btn');
    }

    show(sessionStats) {
        console.log('🎮 显示结算界面，sessionStats:', sessionStats);
        
        if (!sessionStats) {
            console.warn('⚠️ sessionStats为null，使用默认值');
            sessionStats = {
                summary: {
                    totalKills: 0,
                    totalDamage: 0,
                    totalHits: 0,
                    totalHeadshots: 0
                },
                duration: 0
            };
        }
        
        this.isVisible = true;
        this.updateContent(sessionStats);
        this.screen.style.display = 'block';
        this.bindEvents();
    }

    hide() {
        this.isVisible = false;
        this.screen.style.display = 'none';
        this.unbindEvents();
    }

    updateContent(sessionStats) {
        // 设置游戏结果
        if (state.health <= 0) {
            this.resultTitle.textContent = 'MISSION FAILED';
            this.resultTitle.style.color = '#ef4444';
        } else {
            this.resultTitle.textContent = 'MISSION COMPLETE';
            this.resultTitle.style.color = '#22c55e';
        }
        
        // 本局收益（主要指标）：击杀得分 + 背包物资价值
        const missionScore = state.lastMissionScore != null ? state.lastMissionScore : (state.score || 0);
        const lootValue = state.lastLootValue != null ? state.lastLootValue : 0;
        const totalEarnings = state.lastTotalEarnings != null ? state.lastTotalEarnings : (missionScore + lootValue);
        this.sessionEarnings.textContent = totalEarnings;
        
        // 核心统计
        this.sessionKills.textContent = sessionStats?.summary?.totalKills || 0;
        
        // 游戏时长 - 使用sessionStats中的duration，备用state.gameStartTime
        const duration = sessionStats?.duration || (state.gameStartTime ? Math.floor((Date.now() - state.gameStartTime) / 1000) : 0);
        this.sessionDuration.textContent = Math.round(duration) + 's';
        
        // 总伤害
        this.damageDealt.textContent = Math.round(sessionStats?.summary?.totalDamage || 0);
        
        // 计算爆头率
        const totalHits = sessionStats?.summary?.totalHits || 0;
        const totalHeadshots = sessionStats?.summary?.totalHeadshots || 0;
        const headshotRateValue = totalHits > 0 ? Math.round((totalHeadshots / totalHits) * 100) : 0;
        this.headshotRate.textContent = headshotRateValue + '%';
        
        // 调试日志
        console.log('📊 结算界面数据:', {
            sessionStats,
            duration,
            totalDamage: sessionStats?.summary?.totalDamage,
            totalKills: sessionStats?.summary?.totalKills,
            missionScore,
            lootValue,
            totalEarnings
        });
    }

    bindEvents() {
        this.leaveBtn.onclick = () => this.onLeave();
    }

    unbindEvents() {
        this.leaveBtn.onclick = null;
    }

    onLeave() {
        // 先显示主菜单，避免UI闪烁
        import('./ui.js').then(({ showMenu }) => {
            showMenu(true, state.score);
            // 短暂延迟确保主菜单完全显示后再隐藏结算界面
            setTimeout(() => {
                this.hide();
            }, 100);
        });
    }

    // 静态方法：方便直接调用
    static show(sessionStats) {
        if (!this.instance) {
            this.instance = new GameOverScreen();
        }
        this.instance.show(sessionStats);
    }

    static hide() {
        if (this.instance) {
            this.instance.hide();
        }
    }
}

// 导出单例实例
export const gameOverScreen = new GameOverScreen();
