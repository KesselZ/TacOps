import * as THREE from 'three';
import { state } from './globals.js';

function ensureAudioContext() {
    if(!state.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        state.audioCtx = new AudioCtx();
    }
    return state.audioCtx;
}

export function playWeaponShotSound() {
    const audio = ensureAudioContext();
    const now = audio.currentTime;

    const noiseBuffer = audio.createBuffer(1, audio.sampleRate * 0.15, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.6;
    }
    const noise = audio.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = audio.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1800, now);
    noiseFilter.Q.setValueAtTime(1.2, now);

    const boom = audio.createOscillator();
    boom.type = 'square';
    boom.frequency.setValueAtTime(90, now);
    boom.frequency.exponentialRampToValueAtTime(55, now + 0.08);

    const gain = audio.createGain();
    const pan = audio.createStereoPanner();

    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    pan.pan.setValueAtTime((Math.random() - 0.5) * 0.2, now);

    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    boom.connect(gain);
    gain.connect(pan);
    pan.connect(audio.destination);

    noise.start(now);
    noise.stop(now + 0.15);
    boom.start(now);
    boom.stop(now + 0.2);
}

export function playHitmarkerSound(isHeadshot = false) {
    const audio = ensureAudioContext();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    osc.type = 'square';

    if (isHeadshot) {
        osc.frequency.setValueAtTime(1300, now);
        osc.frequency.exponentialRampToValueAtTime(1500, now + 0.04);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    } else {
        osc.frequency.setValueAtTime(950, now);
        osc.frequency.exponentialRampToValueAtTime(1100, now + 0.03);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    }

    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + (isHeadshot ? 0.1 : 0.07));
}

export function playEnemyProximitySound(position) {
    if(!state.camera) return;
    const audio = ensureAudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const pan = audio.createStereoPanner();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, audio.currentTime + 0.3);

    const sourcePos = (position instanceof THREE.Vector3)
        ? position.clone()
        : new THREE.Vector3(position.x, position.y, position.z);
    const relative = sourcePos.sub(state.camera.position);
    const distance = relative.length();
    const volume = THREE.MathUtils.clamp(1 - (distance / 60), 0, 1);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.camera.quaternion);
    const panValue = THREE.MathUtils.clamp(relative.normalize().dot(right), -1, 1);

    gain.gain.setValueAtTime(volume * 0.6, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
    pan.pan.setValueAtTime(panValue, audio.currentTime);

    osc.connect(gain);
    gain.connect(pan);
    pan.connect(audio.destination);

    osc.start();
    osc.stop(audio.currentTime + 0.35);
}

// 火箭弹发射音效
export function playRocketShotSound(sourcePosition = null) {
    const audio = ensureAudioContext();
    const now = audio.currentTime;
    
    // 创建3D Panner
    const panner = create3DPanner(sourcePosition);

    // 火箭弹推进器声音
    const thrust = audio.createOscillator();
    thrust.type = 'sawtooth';
    thrust.frequency.setValueAtTime(150, now);
    thrust.frequency.exponentialRampToValueAtTime(80, now + 0.3);

    // 爆炸冲击波
    const explosion = audio.createOscillator();
    explosion.type = 'square';
    explosion.frequency.setValueAtTime(40, now);
    explosion.frequency.exponentialRampToValueAtTime(20, now + 0.15);

    // 噪音成分
    const noiseBuffer = audio.createBuffer(1, audio.sampleRate * 0.4, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.8;
    }
    const noise = audio.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = audio.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(800, now);

    const gain = audio.createGain();

    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

    thrust.connect(gain);
    explosion.connect(gain);
    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    gain.connect(panner);
    panner.connect(audio.destination);

    thrust.start(now);
    thrust.stop(now + 0.3);
    explosion.start(now);
    explosion.stop(now + 0.15);
    noise.start(now);
    noise.stop(now + 0.4);
}

// 敌人手枪音效
export function playEnemyPistolSound(sourcePosition = null) {
    const audio = ensureAudioContext();
    const now = audio.currentTime;
    
    // 创建3D Panner
    const panner = create3DPanner(sourcePosition);

    const noiseBuffer = audio.createBuffer(1, audio.sampleRate * 0.08, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.4;
    }
    const noise = audio.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = audio.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(2000, now);

    const crack = audio.createOscillator();
    crack.type = 'square';
    crack.frequency.setValueAtTime(800, now);
    crack.frequency.exponentialRampToValueAtTime(400, now + 0.05);

    const gain = audio.createGain();

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    crack.connect(gain);
    gain.connect(panner);
    panner.connect(audio.destination);

    noise.start(now);
    noise.stop(now + 0.08);
    crack.start(now);
    crack.stop(now + 0.05);
}

// 3D音效辅助函数 - 使用PannerNode
function create3DPanner(soundPosition) {
    const audio = ensureAudioContext();
    const panner = audio.createPanner();
    
    // 设置HRTF (头部相关传输函数) - 最真实的3D音效
    panner.panningModel = 'HRTF';
    
    // 设置距离模型 - 'inverse'是最真实的物理模型
    panner.distanceModel = 'inverse';
    
    // 距离参数配置 (基于真实FPS游戏标准)
    panner.refDistance = 1;      // 参考距离：1米内音量不衰减
    panner.maxDistance = 100;    // 最大距离：100米外音量不再衰减
    panner.rolloffFactor = 1;    // 衰减因子：1.0 = 标准衰减
    
    // 设置锥形效果 (可选，用于定向音源)
    panner.coneInnerAngle = 360; // 内锥角度：360度 = 全方向
    panner.coneOuterAngle = 360; // 外锥角度：360度 = 全方向
    panner.coneOuterGain = 0;    // 外锥音量：0 = 完全静音
    
    if (state.camera && soundPosition) {
        // 设置声源位置 (Three.js坐标系 → Web Audio坐标系)
        const sourcePos = (soundPosition instanceof THREE.Vector3)
            ? soundPosition.clone()
            : new THREE.Vector3(soundPosition.x, soundPosition.y, soundPosition.z);
        
        // Web Audio API使用右手坐标系，Three.js使用右手坐标系
        // 但Y轴方向不同，需要转换
        panner.setPosition(sourcePos.x, sourcePos.y, sourcePos.z);
        
        // 设置监听者位置和朝向 (摄像机)
        const camPos = state.camera.position;
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(state.camera.quaternion);
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(state.camera.quaternion);
        
        audio.listener.setPosition(camPos.x, camPos.y, camPos.z);
        audio.listener.setOrientation(camDir.x, camDir.y, camDir.z, camUp.x, camUp.y, camUp.z);
    }
    
    return panner;
}

// 材质撞击音效
export function playMaterialHitSound(materialType = 'stone', hitPosition = null) {
    const audio = ensureAudioContext();
    const now = audio.currentTime;
    
    // 创建3D Panner
    const panner = create3DPanner(hitPosition);

    let mainFreq, decay, filterFreq, gainLevel, hasGravel;
    
    switch(materialType) {
        case 'stone':
            mainFreq = 150;      // 低频石头声
            decay = 0.4;
            filterFreq = 800;
            gainLevel = 0.15;
            hasGravel = true;    // 添加碎石嘎啦声
            break;
        case 'wood':
            mainFreq = 200;      // 低频木头声
            decay = 0.3;
            filterFreq = 600;
            gainLevel = 0.12;
            hasGravel = false;
            break;
        case 'metal':
            mainFreq = 300;      // 金属叮当声
            decay = 0.25;
            filterFreq = 1200;
            gainLevel = 0.18;
            hasGravel = false;
            break;
        case 'dirt':
            mainFreq = 80;       // 超低频泥土声
            decay = 0.5;
            filterFreq = 400;
            gainLevel = 0.1;
            hasGravel = true;    // 泥土颗粒声
            break;
        default:
            mainFreq = 120;
            decay = 0.35;
            filterFreq = 700;
            gainLevel = 0.13;
            hasGravel = true;
    }

    // 主撞击声 - 低频
    const impact = audio.createOscillator();
    impact.type = 'sine';
    impact.frequency.setValueAtTime(mainFreq, now);
    impact.frequency.exponentialRampToValueAtTime(mainFreq * 0.4, now + decay * 0.7);

    // 碎石/颗粒噪音
    const noiseBuffer = audio.createBuffer(1, audio.sampleRate * decay, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        // 添加更多低频成分，减少高频
        data[i] = (Math.random() * 2 - 1) * (hasGravel ? 0.8 : 0.4);
        if (hasGravel && i % 10 < 3) {
            // 嘎啦嘎啦效果：随机间隔的颗粒声
            data[i] *= (Math.random() * 2 - 1) * 0.5;
        }
    }
    const noise = audio.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = audio.createBiquadFilter();
    noiseFilter.type = 'lowpass';  // 改为低通滤波，减少高频
    noiseFilter.frequency.setValueAtTime(filterFreq, now);

    // 嘎啦声效果 - 多个短促的高频冲击
    let gravelGain = null;
    if (hasGravel) {
        const gravelCount = materialType === 'dirt' ? 8 : 5;
        for (let i = 0; i < gravelCount; i++) {
            const gravel = audio.createOscillator();
            gravel.type = 'square';
            const gravelFreq = 300 + Math.random() * 500;
            const gravelDelay = Math.random() * 0.15;
            const gravelDuration = 0.02 + Math.random() * 0.03;
            
            gravel.frequency.setValueAtTime(gravelFreq, now + gravelDelay);
            gravel.frequency.exponentialRampToValueAtTime(gravelFreq * 0.3, now + gravelDelay + gravelDuration);
            
            const gGain = audio.createGain();
            gGain.gain.setValueAtTime(0, now);
            gGain.gain.setValueAtTime(gainLevel * 0.3, now + gravelDelay);
            gGain.gain.exponentialRampToValueAtTime(0.001, now + gravelDelay + gravelDuration);
            
            gravel.connect(gGain);
            gGain.connect(audio.destination);
            gravel.start(now + gravelDelay);
            gravel.stop(now + gravelDelay + gravelDuration);
        }
    }

    const gain = audio.createGain();

    // 设置基础音量 (PannerNode会自动处理距离衰减)
    gain.gain.setValueAtTime(gainLevel, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

    impact.connect(gain);
    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    gain.connect(panner);
    panner.connect(audio.destination);

    impact.start(now);
    impact.stop(now + decay);
    noise.start(now);
    noise.stop(now + decay);
}

// 火箭弹爆炸音效
export function playRocketExplosionSound(sourcePosition = null) {
    const audio = ensureAudioContext();
    const now = audio.currentTime;
    
    // 创建3D Panner
    const panner = create3DPanner(sourcePosition);

    // 低频爆炸声
    const boom = audio.createOscillator();
    boom.type = 'square';
    boom.frequency.setValueAtTime(30, now);
    boom.frequency.exponentialRampToValueAtTime(15, now + 0.4);

    // 高频碎裂声
    const shrapnel = audio.createOscillator();
    shrapnel.type = 'sawtooth';
    shrapnel.frequency.setValueAtTime(300, now);
    shrapnel.frequency.exponentialRampToValueAtTime(100, now + 0.2);

    // 爆炸噪音
    const noiseBuffer = audio.createBuffer(1, audio.sampleRate * 0.6, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.9;
    }
    const noise = audio.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = audio.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(600, now);

    const gain = audio.createGain();

    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);

    boom.connect(gain);
    shrapnel.connect(gain);
    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    gain.connect(panner);
    panner.connect(audio.destination);

    boom.start(now);
    boom.stop(now + 0.4);
    shrapnel.start(now);
    shrapnel.stop(now + 0.2);
    noise.start(now);
    noise.stop(now + 0.6);
}

let _equipBuffer;
let _lootCommonBuffer;
let _lootLegendaryBuffer;

async function ensureEquipBuffer() {
    if (_equipBuffer) return _equipBuffer;
    const audio = ensureAudioContext();
    const res = await fetch('sounds/穿装备.mp3');
    const arrayBuf = await res.arrayBuffer();
    _equipBuffer = await audio.decodeAudioData(arrayBuf);
    return _equipBuffer;
}

async function ensureLootCommonBuffer() {
    if (_lootCommonBuffer) return _lootCommonBuffer;
    const audio = ensureAudioContext();
    const res = await fetch('sounds/出普通.mp3');
    const arrayBuf = await res.arrayBuffer();
    _lootCommonBuffer = await audio.decodeAudioData(arrayBuf);
    return _lootCommonBuffer;
}

async function ensureLootLegendaryBuffer() {
    if (_lootLegendaryBuffer) return _lootLegendaryBuffer;
    const audio = ensureAudioContext();
    const res = await fetch('sounds/出红.mp3');
    const arrayBuf = await res.arrayBuffer();
    _lootLegendaryBuffer = await audio.decodeAudioData(arrayBuf);
    return _lootLegendaryBuffer;
}

export async function playEquipSound() {
    try {
        const audio = ensureAudioContext();
        const buffer = await ensureEquipBuffer();
        
        const source = audio.createBufferSource();
        source.buffer = buffer;
        
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.8, audio.currentTime);
        
        source.connect(gain);
        gain.connect(audio.destination);
        
        source.start();
    } catch (error) {
        console.error('Error playing equip sound:', error);
    }
}

export async function playLootCommonSound() {
    try {
        const audio = ensureAudioContext();
        const buffer = await ensureLootCommonBuffer();

        const source = audio.createBufferSource();
        source.buffer = buffer;

        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.9, audio.currentTime);

        source.connect(gain);
        gain.connect(audio.destination);

        source.start();
    } catch (error) {
        console.error('Error playing loot common sound:', error);
    }
}

export async function playLootLegendarySound() {
    try {
        const audio = ensureAudioContext();
        const buffer = await ensureLootLegendaryBuffer();

        const source = audio.createBufferSource();
        source.buffer = buffer;

        const gain = audio.createGain();
        gain.gain.setValueAtTime(1.0, audio.currentTime);

        source.connect(gain);
        gain.connect(audio.destination);

        source.start();
    } catch (error) {
        console.error('Error playing loot legendary sound:', error);
    }
}

// 滑铲专用音效（简化版：普通 2D 声音，音量较小）
let _slideBuffer = null;
let _slideSource = null;
let _slideGain = null;

async function ensureSlideBuffer() {
    if (_slideBuffer) return _slideBuffer;
    const audio = ensureAudioContext();
    const res = await fetch('sounds/slide.mp3');
    const arrayBuf = await res.arrayBuffer();
    _slideBuffer = await audio.decodeAudioData(arrayBuf);
    return _slideBuffer;
}

export async function playSlideSound(position) { // position 参数保留以兼容调用方，但此处不再使用 3D/HRTF
    try {
        const audio = ensureAudioContext();
        const buffer = await ensureSlideBuffer();

        // 如果之前有在播的滑铲声，先做一次淡出，避免叠音
        if (_slideSource && _slideGain) {
            const t = audio.currentTime;
            _slideGain.gain.cancelScheduledValues(t);
            _slideGain.gain.setValueAtTime(_slideGain.gain.value, t);
            _slideGain.gain.linearRampToValueAtTime(0.0, t + 0.05);
            _slideSource.stop(t + 0.06);
        }

        const source = audio.createBufferSource();
        source.buffer = buffer;

        const gain = audio.createGain();
        const baseGain = 0.25; // 较小音量即可，不再特别突出
        const now = audio.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(baseGain, now + 0.03); // 短淡入，避免突兀

        const stereo = audio.createStereoPanner();
        // 居中，不随场景左右移动，相当于“在自己身体正下方”的感觉
        stereo.pan.setValueAtTime(0, now);

        source.connect(gain);
        gain.connect(stereo);
        stereo.connect(audio.destination);

        source.start(now);

        _slideSource = source;
        _slideGain = gain;
    } catch (e) {
        // 解码或播放失败时静默忽略
    }
}

export function stopSlideSound() {
    try {
        const audio = state.audioCtx;
        if (!_slideSource || !_slideGain || !audio) return;

        const t = audio.currentTime;
        _slideGain.gain.cancelScheduledValues(t);
        _slideGain.gain.setValueAtTime(_slideGain.gain.value, t);
        _slideGain.gain.linearRampToValueAtTime(0.0, t + 0.06); // 短淡出
        _slideSource.stop(t + 0.07);

        _slideSource = null;
        _slideGain = null;
    } catch (e) {
        // 忽略极端错误
    }
}

// 现在滑铲音效不再使用 3D 声源，这里保持为空实现以兼容调用方
export function updateSlideSoundPosition(position) {
    // no-op
}

