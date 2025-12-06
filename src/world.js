import * as THREE from 'three';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer, RenderPass, BloomEffect, EffectPass, SSAOEffect, NormalPass } from 'postprocessing';
import { createTexture } from './utils.js';
import { state } from './globals.js';
import { CONFIG } from './config.js';
import { playEquipSound } from './audio.js';
import { hideGlobalLoading } from './ui.js';
import { generateCityScene, CITY_GRID_CONFIG } from './cityGenerator.js';
import { createMapGenerator } from './mapGenerator.js';
import { collisionGrid } from './collisionGrid.js';
import { toggleBackpack } from './backpackUI.js';
import { generateContainerLoot } from './lootTables.js';

// Assuming CANNON is globally available via script tag in index.html
const CANNON = window.CANNON;

// 环境预设：目前支持 day / night，以后可以继续扩展更多地图/天气
const ENV_PROFILES = Object.freeze({
    day: {
        fogColor: 0x87ceeb,
        // 天空盒：偏亮的蓝天
        skyTop: '0.1, 0.3, 0.6',   // 顶部深蓝
        skyBottom: '0.7, 0.8, 0.9', // 地平线浅蓝
        // 环境光 & 平行光（太阳）
        ambSkyColor: 0xffffff,
        ambGroundColor: 0x222222,
        ambIntensity: 0.4, // 从0.5降低到0.4
        dirColor: 0xffffff,
        dirIntensity: 1.3 // 从1.1提高到1.3
    },
    night: {
        fogColor: 0x050814,
        // 天空盒：优化渐变的夜空，增加颜色范围避免阶梯效应
        skyTop: '0.12, 0.16, 0.30', // 顶部深蓝（提高亮度）
        skyBottom: '0.04, 0.04, 0.12', // 地平线暗蓝（提高底色）
        // 夜晚：幽蓝静谧色调，环境光和地面光都偏蓝
        ambSkyColor: 0x3366aa, // 更蓝的天空环境光
        ambGroundColor: 0x112244, // 增加蓝色调的地面环境光
        ambIntensity: 0.4, // 从0.35提高到0.5
        dirColor: 0x99ccff, // 稍微蓝一点的月光
        dirIntensity: 0.35 // 从0.45降低到0.35
    },
    sunset: {
        // 暖色晚霞雾气：略带橙红
        fogColor: 0x3b1f1a,
        // 天空盒：地平线偏橙红，上方偏紫蓝
        skyTop: '0.10, 0.05, 0.18',   // 顶部偏紫蓝
        skyBottom: '0.85, 0.45, 0.20', // 地平线橙红
        // 晚霞：整体略暗，环境光偏暖，太阳光偏橙
        ambSkyColor: 0xffe0b2,
        ambGroundColor: 0x331a0f,
        ambIntensity: 0.35,
        dirColor: 0xff9933,
        dirIntensity: 0.7
    }
});

// 生成带有太阳/月亮的天空盒Shader
function generateSkyShader(envProfile) {
    // 太阳参数（day模式）- 纯白色，简单光晕
    const sunColor = 'vec3(1.0, 1.0, 1.0)';   // 太阳：纯白色
    const sunSize = 0.05;  // 太阳尺寸 - 更大
    const sunGlow = 0.008; // 太阳：简单白色光晕
    
    // 日落太阳参数 - 暖橙色，与日落天空协调
    const sunsetSunColor = 'vec3(1.0, 0.5, 0.2)'; // 日落太阳：纯正橙色
    
    // 月亮参数（night模式）- 保持独立，确保光晕效果
    const moonColor = 'vec3(0.87, 0.87, 1.0)';  // 月亮：偏冷的淡蓝白
    const moonSize = 0.02;  // 月亮尺寸
    const moonGlow = 0.005; // 月亮光晕（保持光晕！）
    
    return `
        varying vec3 vWorldPosition;
        varying vec3 vSkyDir;
        
        vec3 top = vec3(${envProfile.skyTop});
        vec3 bot = vec3(${envProfile.skyBottom});
        
        void main() {
            vec3 dir = normalize(vSkyDir);
            float h = max(dir.y, 0.0);  // 垂直高度
            
            // 方向性计算：用于日落时的东西方向渐变，让日落色更集中在正西边
            float eastWest = dir.x;  // X方向：东(+1)到西(-1)
            float directionalFactor = pow(max(eastWest + 1.0, 0.0) * 0.5, 2.0);  // 使用平方函数，让日落色更集中在西边
            
            // 基础天空渐变
            vec3 skyColor;
            
            if (${state.environmentMode === 'sunset' ? 'true' : 'false'}) {
                // 日落模式：方向性渐变
                // 西边(日落方向)使用暖色，东边使用冷色
                vec3 sunsetTop = vec3(${envProfile.skyTop});      // 顶部颜色
                vec3 sunsetBottom = vec3(${envProfile.skyBottom}); // 地平线颜色
                vec3 nightTop = vec3(0.03, 0.05, 0.12);           // 夜晚顶部
                vec3 nightBottom = vec3(0.01, 0.01, 0.03);        // 夜晚地平线
                
                // 垂直渐变
                vec3 sunsetVertical = mix(sunsetBottom, sunsetTop, h);
                vec3 nightVertical = mix(nightBottom, nightTop, h);
                
                // 水平方向混合：西边日落，东边夜晚
                skyColor = mix(sunsetVertical, nightVertical, directionalFactor);
            } else {
                // 白天/夜晚：传统垂直渐变
                vec3 top = vec3(${envProfile.skyTop});
                vec3 bot = vec3(${envProfile.skyBottom});
                skyColor = mix(bot, top, h);
            }
            
            // 根据环境模式选择天体参数
            vec3 celestialColor;
            float celestialSize;
            float celestialGlow;
            
            if (${state.environmentMode === 'night' ? 'true' : 'false'}) {
                // 夜晚：使用月亮参数
                celestialColor = ${moonColor};
                celestialSize = ${moonSize};
                celestialGlow = ${moonGlow};
            } else if (${state.environmentMode === 'sunset' ? 'true' : 'false'}) {
                // 日落：使用暖色太阳参数
                celestialColor = ${sunsetSunColor};
                celestialSize = ${sunSize};
                celestialGlow = ${sunGlow};
            } else {
                // 白天：使用纯白色太阳参数
                celestialColor = ${sunColor};
                celestialSize = ${sunSize};
                celestialGlow = ${sunGlow};
            }
            
            // 太阳/月亮位置（根据环境模式调整方向）
            vec3 celestialDir;
            if (${state.environmentMode === 'sunset' ? 'true' : 'false'}) {
                // 日落：太阳在西向地平线正中央，与颜色渐变轴向一致
                celestialDir = normalize(vec3(-1.0, 0.05, 0.0)); // 紧贴地平线、正西方向
            } else {
                // 白天/夜晚：太阳/月亮在右上方
                celestialDir = normalize(vec3(0.6, 0.8, 0.4));   // 右上方
            }
            
            // 让天空渐变在日/夜模式下朝向天体方向发生轻微偏色，视觉上更一致
            if (!(${state.environmentMode === 'sunset' ? 'true' : 'false'})) {
                float dirDot = max(dot(dir, celestialDir), 0.0);
                float dirLerp = pow(dirDot, ${state.environmentMode === 'night' ? '6.0' : '4.5'});
                vec3 tint = celestialColor * ${state.environmentMode === 'night' ? '0.05' : '0.25'};
                skyColor = mix(skyColor, skyColor + tint, dirLerp);
            }
            
            // 计算太阳/月亮的可见性
            float celestialDot = dot(dir, celestialDir);
            float celestialAngle = acos(celestialDot);
            
            // 太阳/月亮本体（纯色）
            float celestialDisc = 1.0 - smoothstep(celestialSize - 0.001, celestialSize + 0.001, celestialAngle);
            
            // 简单光晕效果
            float celestialGlowEffect = 1.0 - smoothstep(celestialSize + celestialGlow, celestialSize + celestialGlow * 2.5, celestialAngle);
            
            // 太阳本体平滑混合
            skyColor = mix(skyColor, celestialColor, celestialDisc);
            
            // 光晕平滑叠加（避免黑边）
            skyColor += celestialColor * 0.6 * celestialGlowEffect;
            
            gl_FragColor = vec4(skyColor, 1.0);
        }
    `;
}

const CITY_LAYOUT = Object.freeze({
    halfSize: 450,  // 保留默认值，但实际地板大小将根据 CITY_GRID_CONFIG 动态计算
    openAreaHalfX: 45,  // 稍微增大
    openAreaHalfZ: 100, // 稍微增大
    blockSpacing: 110,  // 增大街区间距
    propScatterRadius: 400,  // 调整道具散布半径
    propCount: 220,  // 增加道具数量
    tallChance: 0.3,
    tallExtraMin: 30,
    tallExtraMax: 90,
    spawnGridStep: 30,    // 🆕 从75米减小到30米，大幅增加检测点密度
    spawnSafeRadius: 15   // 🆕 从25米减小到15米，允许更靠近中心生成
});

export function initGraphics() {
    state.scene = new THREE.Scene();

    // 天空模式将在buildLevel()中随机选择，这里使用默认day模式
    state.environmentMode = 'day';
    const envProfile = ENV_PROFILES[state.environmentMode] || ENV_PROFILES.day;

    // 轻量调试：在控制台打印当前环境模式
    console.log('🌗 Initial environment mode:', state.environmentMode, envProfile);

    // 初始雾参数：颜色来自环境预设，far 之后仍由渲染距离预设调整
    state.scene.fog = new THREE.Fog(envProfile.fogColor, 10, 500);

    // 相机：near 使用 0.1 提升深度精度，far 之后根据渲染距离预设调整
    state.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 900);
    state.camera.rotation.order = 'YXZ';
    state.cameraYaw = 0;
    state.cameraPitch = 0;

    // 第二个相机：专门用于渲染武器（近裁剪面更小，避免穿模）
    const aspect = window.innerWidth / window.innerHeight;
    state.weaponCamera = new THREE.PerspectiveCamera(state.camera.fov + 5, aspect, 0.01, 3);
    state.weaponCamera.rotation.order = 'YXZ';
    state.weaponCamera.layers.set(1);

    // 抗锯齿始终开启，不再暴露为设置项
    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.autoClear = false;
    // 手动控制渲染统计的重置时机（只统计主相机）
    if (state.renderer.info) {
        state.renderer.info.autoReset = false;
    }
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    // 阴影开关：当阴影质量为 off 时关闭阴影
    const initialShadowEnabled = (state.shadowQuality || 'high') !== 'off';
    state.shadowsEnabled = initialShadowEnabled;
    state.renderer.shadowMap.enabled = initialShadowEnabled;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // 色调映射：提升阴影和 光照质量
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 0.8;  // 降低曝光度，从1.2降到0.8

    // 最小幅度开启后处理：只添加基础composer
    state.composer = new EffectComposer(state.renderer, {
        multisampling: 4  // 启用4x MSAA抗锯齿
    });
    const renderPass = new RenderPass(state.scene, state.camera);
    const bloomEffect = new BloomEffect({
        intensity: 1.5,  // 辉光强度
        radius: 0.8,     // 增大光晕扩散半径
        luminanceThreshold: 0.9  // 亮度阈值，只有超过这个值的像素才会发光
    });
    
    // 添加NormalPass来提供法线信息给SSAOEffect
    const normalPass = new NormalPass(state.scene, state.camera);
    
    // 正确使用SSAOEffect，传入camera和normalBuffer
    // 暂时关闭 SSAO 以便观察夜晚亮度
    // const ssaoEffect = new SSAOEffect(state.camera, normalPass.texture, {
    //     width: window.innerWidth,
    //     height: window.innerHeight,
    //     radius: 0.7,        // 更紧凑的范围，贴近墙角
    //     intensity: 8.0,     // 极大增强强度，方便观察
    //     bias: 0.015,        // 更贴近接触面
    //     fade: 0.02,         // 让阴影快速衰减
    //     luminanceInfluence: 0.0,  // 完全忽略亮度，突出黑色
    //     samples: 32,
    //     rings: 6
    // });
    // ssaoEffect.distanceScaling = true;
    // ssaoEffect.setDistanceCutoff(80, 40); // 使用用户指定的距离阈值
    
    // 创建EffectPass，暂时只包含Bloom，不含SSAO
    const effectPass = new EffectPass(state.camera, bloomEffect);
    
    // 按正确顺序添加pass：render -> normal -> effects
    state.composer.addPass(renderPass);
    state.composer.addPass(normalPass);
    state.composer.addPass(effectPass);
    
    document.getElementById('game-container').appendChild(state.renderer.domElement);

    // 修复天空盒：根据当前环境预设选择不同的渐变颜色，并添加太阳/月亮
    const vertexShader = `varying vec3 vSkyDir; varying vec3 vWorldPosition; void main() { vec4 worldPosition = modelMatrix * vec4( position, 1.0 ); vWorldPosition = worldPosition.xyz; vSkyDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
    
    // 根据环境模式生成不同的fragment shader
    const fragmentShader = generateSkyShader(envProfile);
    
    // 使用高细致度的球体天空盒，确保太阳/月亮完美圆形
    const skyGeo = new THREE.SphereGeometry(400, 64, 64); // 半径400米，64×64分段，更平滑
    const skyMat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false });
    state.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    state.scene.add(state.skyMesh);
    state.skyMesh.onBeforeRender = function(renderer, scene, camera) { this.position.copy(camera.position); };

    // 将主相机和武器相机加入场景
    state.scene.add(state.camera);
    if (state.weaponCamera) {
        state.scene.add(state.weaponCamera);
    }

    const amb = new THREE.HemisphereLight(
        envProfile.ambSkyColor,
        envProfile.ambGroundColor,
        envProfile.ambIntensity
    );
    // 环境光同时照亮世界(layer 0)和武器(layer 1)
    amb.layers.enable(0);
    amb.layers.enable(1);
    state.scene.add(amb);

    const dir = new THREE.DirectionalLight(envProfile.dirColor, envProfile.dirIntensity);
    // 方向光同样照亮两个layer，保证金属高光在武器上可见
    dir.layers.enable(0);
    dir.layers.enable(1);
    const defaultDirPos = new THREE.Vector3(80, 120, 50);
    const sunsetDirPos = new THREE.Vector3(-80, 60, 0);
    state.dirLightDefaultOffset = defaultDirPos.clone();
    state.dirLightSunsetOffset = sunsetDirPos.clone();
    dir.position.copy(defaultDirPos);
    // 使用全局开关控制方向光是否投射阴影
    dir.castShadow = initialShadowEnabled;

    // 根据阴影质量设置 shadow map 分辨率（off 时尺寸仍可设定，但不会实际渲染阴影）
    const quality = state.shadowQuality || 'high';
    let shadowSize = 4096;
    if (quality === 'medium') {
        shadowSize = 2048;
    }

// 根据渲染距离预设调整雾和相机的视距
function applyRenderDistanceProfile(profile) {
    if (!state.scene || !state.camera || !state.scene.fog) return;

    const mode = profile || state.renderDistance || 'ultra';
    let fogFar = 500;
    let camFar = 900;

    if (mode === 'near') {
        fogFar = 200;
        camFar = 400;
    } else if (mode === 'medium') {
        fogFar = 300;
        camFar = 650;
    } else if (mode === 'far') {
        fogFar = 500;
        camFar = 900;
    } else if (mode === 'ultra') {
        fogFar = 700;
        camFar = 1300;
    }

    state.scene.fog.near = 10;
    state.scene.fog.far = fogFar;
    state.camera.near = 0.1;
    state.camera.far = camFar;
    state.camera.updateProjectionMatrix();
}
    dir.shadow.mapSize.set(shadowSize, shadowSize);
    dir.shadow.bias = -0.0001;
    dir.shadow.normalBias = 0.002;
    dir.shadow.camera.left = -150; dir.shadow.camera.right = 150;
    dir.shadow.camera.top = 150; dir.shadow.camera.bottom = -150;
    
    // PCSS软阴影设置：模拟面积光源
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 350;
    dir.shadow.radius = 3; // 软阴影半径（阴影质量设置)
    state.scene.add(dir);
    state.dirLight = dir;

    // 根据当前渲染距离预设应用雾和相机视距
    const profile = state.renderDistance || 'ultra';
    applyRenderDistanceProfile(profile);

    // 材质定义 (带颜色标识，用于掉渣)
    state.mats.wall = new THREE.MeshStandardMaterial({ map: createTexture('#777'), roughness: 0.9 });
    state.mats.wall.userData.debrisColor = 0x777777;
    
    state.mats.floor = new THREE.MeshStandardMaterial({ map: createTexture('#222', 'noise'), roughness: 0.8 });
    state.mats.floor.userData.debrisColor = 0x222222;
    
    state.mats.building = new THREE.MeshStandardMaterial({ map: createTexture('#444', 'building'), roughness: 0.4 });
    state.mats.building.userData.debrisColor = 0x444444;
    
    // 新增建筑材质
    state.mats.residential = new THREE.MeshStandardMaterial({ map: createTexture('#8d6e63', 'residential'), roughness: 0.7 });
    state.mats.residential.userData.debrisColor = 0x8d6e63;
    
    state.mats.commercial = new THREE.MeshStandardMaterial({ map: createTexture('#546e7a', 'commercial'), roughness: 0.5 });
    state.mats.commercial.userData.debrisColor = 0x546e7a;
    
    state.mats.industrial = new THREE.MeshStandardMaterial({ map: createTexture('#37474f', 'industrial'), roughness: 0.3 });
    state.mats.industrial.userData.debrisColor = 0x37474f;
    
    state.mats.glass = new THREE.MeshStandardMaterial({ color: 0x64b5f6, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.8 });
    state.mats.glass.userData.debrisColor = 0x64b5f6;
    
    state.mats.box = new THREE.MeshStandardMaterial({ map: createTexture('#795548', 'wood'), roughness: 0.8 });
    state.mats.box.userData.debrisColor = 0x795548; // Wood color
    
    state.mats.metal = new THREE.MeshStandardMaterial({ map: createTexture('#455a64', 'metal'), roughness: 0.3, metalness: 0.6 });
    state.mats.metal.userData.debrisColor = 0x90a4ae; // Spark color
    
    state.mats.road = new THREE.MeshStandardMaterial({ map: createTexture('#2b2b2b', 'asphalt'), roughness: 0.95 });
    state.mats.road.userData = { debrisColor: 0x2a2a2a };
    if (state.mats.road.map) {
        state.mats.road.map.wrapS = state.mats.road.map.wrapT = THREE.RepeatWrapping;
        state.mats.road.map.needsUpdate = true;
    }
    
    state.mats.grass = new THREE.MeshStandardMaterial({ map: createTexture('#4caf50', 'grass'), roughness: 1.0 });
    state.mats.grass.userData = { debrisColor: 0x2e7d32 };
    
    state.mats.sidewalk = new THREE.MeshStandardMaterial({ map: createTexture('#bdbdbd', 'sidewalk'), roughness: 0.85 });
    state.mats.sidewalk.userData = { debrisColor: 0xbdbdbd };
    
    state.mats.treeTrunk = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.9 });
    state.mats.treeTrunk.userData = { debrisColor: 0x4e342e };
    state.mats.treeLeaf = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.6 });
    state.mats.treeLeaf.userData = { debrisColor: 0x2e7d32 };
    state.mats.lampBulb = new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xfff3c0, emissiveIntensity: 0.8 });
    
    // 新增现代化建筑材质
    state.mats.modernGlass = new THREE.MeshStandardMaterial({ 
        map: createTexture('#1a5490', 'modernGlass'), 
        roughness: 0.1,  // 降低粗糙度，更光滑的玻璃
        metalness: 0.2   // 增加金属感
    });
    state.mats.modernGlass.userData.debrisColor = 0x1a5490;
    
    state.mats.concrete = new THREE.MeshStandardMaterial({ 
        map: createTexture('#a8a8b0', 'concrete'), // 略深的中灰，避免偏白
        roughness: 0.95  // 增加粗糙度，更真实的混凝土
    });
    state.mats.concrete.userData.debrisColor = 0xa8a8b0;
    
    state.mats.warmConcrete = new THREE.MeshStandardMaterial({ 
        map: createTexture('#c7c7cd', 'warmConcrete'), 
        roughness: 0.9   // 稍微增加粗糙度
    });
    state.mats.warmConcrete.userData.debrisColor = 0xc7c7cd;
    
    state.mats.redBrick = new THREE.MeshStandardMaterial({ 
        map: createTexture('#b45309', 'redBrick'), 
        roughness: 0.85  // 增加砖块粗糙度
    });
    state.mats.redBrick.userData.debrisColor = 0xb45309;
    
    state.mats.grayBrick = new THREE.MeshStandardMaterial({ 
        map: createTexture('#6b7280', 'grayBrick'), 
        roughness: 0.8   // 适中的粗糙度
    });
    state.mats.grayBrick.userData.debrisColor = 0x6b7280;
    
    state.mats.storefront = new THREE.MeshStandardMaterial({ 
        map: createTexture('#e5e7eb', 'storefront'), 
        roughness: 0.2,  // 降低粗糙度，更光滑的店面玻璃
        metalness: 0.3   // 增加金属框架感
    });
    state.mats.storefront.userData.debrisColor = 0xe5e7eb;
    
    state.mats.metalRoof = new THREE.MeshStandardMaterial({ 
        map: createTexture('#64748b', 'metalRoof'), 
        roughness: 0.3,  // 降低粗糙度，更光滑的金属
        metalness: 0.7   // 增加金属感
    });
    state.mats.metalRoof.userData.debrisColor = 0x64748b;

    state.mats.enemy = new THREE.MeshPhongMaterial({ color: 0x4b5563 });
    state.mats.tracer = new THREE.LineBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.8 });

    // 提升关键地面纹理清晰度：根据设置应用各向异性过滤
    const maxAniso = state.renderer.capabilities.getMaxAnisotropy();
    const texTargets = [
        state.mats.road?.map,
        state.mats.sidewalk?.map,
        state.mats.floor?.map
    ];
    const anisoQuality = state.anisoQuality || 'max';
    let anisoValue = 1; // Low: 1x
    if (anisoQuality === 'medium') {
        anisoValue = Math.max(1, Math.floor(maxAniso / 2));
    } else if (anisoQuality === 'max') {
        anisoValue = maxAniso;
    }
    texTargets.forEach(tex => {
        if (tex) {
            tex.anisotropy = anisoValue;
            tex.needsUpdate = true;
        }
    });
}

export function initPhysics() {
    console.log('🔬 initPhysics() 函数开始执行');
    
    state.world = new CANNON.World();
    console.log('🔬 CANNON.World 创建成功');
    
    state.world.gravity.set(0, -20, 0); 
    
    // 统一默认接触材质：即便刚体没有显式指定 material，也会落到同样的摩擦/弹性
    if (state.world.defaultContactMaterial) {
        state.world.defaultContactMaterial.friction = 0.0;  // 摩擦力设为0，完全手动控制移动
        state.world.defaultContactMaterial.restitution = 0.0;
    }
    state.world.broadphase = new CANNON.SAPBroadphase(state.world);
    state.world.solver.iterations = 10;
    console.log('🔬 物理世界初始化完成: 使用 SAPBroadphase (O(n log n))');

    state.physicsMaterial = new CANNON.Material('physics');
    const contactMat = new CANNON.ContactMaterial(state.physicsMaterial, state.physicsMaterial, {
        friction: 0.0,  // 摩擦力设为0，完全手动控制移动
        restitution: 0.0
    });
    state.world.addContactMaterial(contactMat);

    const radius = 0.5;
    // 设置碰撞组，让敌人之间不碰撞
    // 使用位掩码：1=玩家，2=敌人，4=静态环境
    state.collisionGroups = {
        PLAYER: 1,
        ENEMY: 2,
        STATIC: 4
    };
    
    // 玩家与所有组碰撞
    state.playerBody = new CANNON.Body({
        mass: 60, shape: new CANNON.Sphere(radius),
        material: state.physicsMaterial, fixedRotation: true,
        collisionFilterGroup: state.collisionGroups.PLAYER,
        collisionFilterMask: state.collisionGroups.PLAYER | state.collisionGroups.ENEMY | state.collisionGroups.STATIC
    });
    
    state.playerBody.linearDamping = 0.0; // 取消线性阻尼，观察真实滑落行为
    state.world.addBody(state.playerBody);

    // 性能监控：定期报告物理世界状态
    console.log('🔬 物理监控已加载');
    
    // 物理步进性能监控变量
    let physicsStepCount = 0;
    let physicsStepTime = 0;
    let physicsLastReportTime = 0;
    
    // 测试：确认 Hook 是否成功
    setTimeout(() => {
        console.log('🔬 物理监控 Hook 测试: world.step 函数类型 =', typeof state.world.step);
    }, 2000);
    
    // 备用监控：每5秒显示物理世界状态（不管游戏是否激活）
    setInterval(() => {
        if (state.world && state.world.bodies) {
            const bodyCount = state.world.bodies.length;
            const theoreticalPairs = (bodyCount * (bodyCount - 1)) / 2;
            console.log(`🔬 物理世界状态: Body数量=${bodyCount}, 理论检测对数=${theoreticalPairs}, 使用SAPBroadphase(O(n log n)), 游戏状态=${state.isGameActive ? '激活' : '未激活'}`);
        }
    }, 5000);
    
    console.log('🔬 所有物理监控设置完成');
    
    // 监控物理步进性能
    const originalStep = state.world.step;
    state.world.step = function(dt, timeStep, maxSubSteps) {
        const startTime = performance.now();
        const result = originalStep.call(this, dt, timeStep, maxSubSteps);
        const endTime = performance.now();
        
        physicsStepCount++;
        physicsStepTime += (endTime - startTime);
        
        // 每5秒报告一次
        const now = performance.now();
        if (now - physicsLastReportTime > 5000) {
            const avgTime = physicsStepCount > 0 ? physicsStepTime / physicsStepCount : 0;
            const bodyCount = this.bodies ? this.bodies.length : 0;
            const theoreticalPairs = (bodyCount * (bodyCount - 1)) / 2;
            console.log(`🔬 物理碰撞监控: 5秒内${physicsStepCount}次步进, 平均${avgTime.toFixed(3)}ms/次, Body数量=${bodyCount}, 理论检测对数=${theoreticalPairs}, 使用SAPBroadphase(O(n log n))`);
            physicsStepCount = 0;
            physicsStepTime = 0;
            physicsLastReportTime = now;
        }
        
        return result;
    };
    
    state.playerMesh = new THREE.Mesh(new THREE.SphereGeometry(radius), new THREE.MeshBasicMaterial({visible: false}));
    state.playerMesh.userData.isPlayer = true;
    state.playerMesh.userData.isDynamic = true;
    state.playerMesh.userData.isStatic = false;
    state.playerMesh.userData.isActive = true; // 玩家永远活跃
    state.playerMesh.userData.bounds = {x: 0, z: 0, width: radius*2, depth: radius*2, height: radius*2};
    // 玩家碎片由 playerHit.js 统一生成，根据护甲判断颜色
    // 不在这里设置 canDebris，避免重复生成
    state.scene.add(state.playerMesh);
}

// 安全的生成点网格（避免建筑内部）
function registerSafeSpawnGrid() {
    state.spawnPoints.length = 0;
    const { spawnGridStep, spawnSafeRadius } = CITY_LAYOUT;
    // 根据城市街区配置动态计算城市半径，使地板和生成点范围刚好覆盖整个城市
    const { blockSize, roadWidth, gridSize } = CITY_GRID_CONFIG;
    const cityTotalSize = gridSize * (blockSize + roadWidth) - roadWidth;
    const halfSize = cityTotalSize / 2;
    
    // 🆕 生成点采样网格步长：完全根据当前城市尺寸推导
    // 思路：
    //  - 城市物理宽度为 cityTotalSize
    //  - 希望在任意地图下，采样网格在每个轴上的分段数大致保持在一个目标范围
    //  - 由此反推步长: step ≈ cityTotalSize / targetCellsPerAxis
    //  - 这里把 targetCellsPerAxis 从 150 提到 300，相当于每条边格子数翻倍，总检测点数量约 4 倍，更加密集
    const TARGET_CELLS_PER_AXIS = 300; // 期望的采样网格分段数（与 gridSize 无关）
    let step = cityTotalSize / TARGET_CELLS_PER_AXIS;
    
    // 再结合 spawnGridStep 作为一个“最小可接受步长”的下界提示
    const minStep = Math.max(5, spawnGridStep * 0.2); // 至少 5 米，且不小于原始步长的一部分
    const maxStep = Math.max(20, spawnGridStep * 2.0); // 允许在大地图上适度放大
    step = Math.max(minStep, Math.min(step, maxStep));
    
    console.log(`🔍 开始检查生成点，网格步长: ${step.toFixed(1)}米，碰撞网格统计:`, collisionGrid.getStats());
    
    let totalChecked = 0;
    let collisionFailed = 0;
    
    for(let x = -halfSize; x <= halfSize; x += step) {
        for(let z = -halfSize; z <= halfSize; z += step) {
            totalChecked++;
            
            // 检查是否是安全位置（只检查建筑碰撞）
            if (isSafeSpawnPosition(x, z)) {
                state.spawnPoints.push(new THREE.Vector3(x, 5, z));
            } else {
                // 统计失败原因
                if (checkBuildingCollision(x, z, 3)) {
                    collisionFailed++;
                }
            }
        }
    }
    
    console.log(`📍 生成点统计: 总检查=${totalChecked}, 成功=${state.spawnPoints.length}, 碰撞失败=${collisionFailed}`);
    console.log(`📍 生成 ${state.spawnPoints.length} 个安全生成点（包括中心区域）`);
}

// 从采样到的spawnPoints中预选固定数量的敌人刷怪点
function preselectEnemySpawnPoints() {
    // 根据难度设置敌人数量
    let maxEnemies = 500; // 默认值
    if (state.selectedDifficulty === 'hard') {
        maxEnemies = 8000; // 困难模式8000个敌人
    } else if (state.selectedDifficulty === 'insane') {
        maxEnemies = 10000; // 疯狂模式10000个敌人
    } else {
        maxEnemies = 6000; // 普通模式6000个敌人
    }
    
    state.enemySpawnIndices = [];
    // 🆕 为每个预选刷怪点预先计算一次带少量随机偏移的安全位置
    state.enemySpawnPositions = [];
    if (!state.spawnPoints || state.spawnPoints.length === 0) return;

    const total = state.spawnPoints.length;
    const desired = Math.min(maxEnemies, total);

    // 简单均匀采样：在整个数组上按步长取点，保证大致铺满全图
    const step = total / desired;
    let offset = Math.random() * step; // 加一点随机偏移，避免每局完全相同

    for (let i = 0; i < desired; i++) {
        const index = Math.floor(offset + i * step);
        if (index >= 0 && index < total) {
            state.enemySpawnIndices.push(index);

            const basePoint = state.spawnPoints[index];
            if (!basePoint) continue;

            // 在原始安全点附近添加少量随机偏移，保持总体分布但避免过于整齐
            const jitterRadius = 8; // 米，足够打乱整齐度，又不至于跨到远处街区
            const maxAttempts = 4;
            let finalPos = basePoint.clone();

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * jitterRadius;
                const jx = basePoint.x + Math.cos(angle) * r;
                const jz = basePoint.z + Math.sin(angle) * r;

                // 复用现有的安全检测逻辑，确保偏移后仍然是合法出生点
                const safe = (typeof window !== 'undefined' && window.isSafeSpawnPosition)
                    ? window.isSafeSpawnPosition(jx, jz)
                    : isSafeSpawnPosition(jx, jz);

                if (safe) {
                    finalPos.set(jx, basePoint.y, jz);
                    break;
                }
            }

            state.enemySpawnPositions.push(finalPos);
        }
    }
}

export function buildArenaLevel() {
    if (!state.scene || !state.world || !state.mats || !state.physicsMaterial) return;

    const size = 100;
    const geometry = new THREE.PlaneGeometry(size * 2, size * 2, 1, 1);
    const material = state.mats.floor || new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    state.scene.add(ground);

    if (state.world && state.physicsMaterial) {
        const groundShape = new CANNON.Plane();
        const groundBody = new CANNON.Body({ mass: 0, shape: groundShape, material: state.physicsMaterial });
        groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0, 'XYZ');
        state.world.addBody(groundBody);
    }
}

export async function updateItemPickupEffects(dt) {
    if (!Array.isArray(state.itemPickupEffects) || state.itemPickupEffects.length === 0) return;
    if (!state.camera) return;

    const target = state.playerMesh ? state.playerMesh.position : state.camera.position;

    for (let i = state.itemPickupEffects.length - 1; i >= 0; i--) {
        const e = state.itemPickupEffects[i];
        e.age += dt;
        const tRaw = e.duration > 0 ? (e.age / e.duration) : 1;
        const t = Math.min(1, tRaw);

        if (tRaw >= 1) {
            // 吸附到玩家，真正把物品放回背包
            if (e.entry) {
                addItemToBackpack({ ...e.entry.item });
            }
            if (e.mesh) {
                if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
                if (e.mesh.geometry) e.mesh.geometry.dispose();
                if (e.mesh.material) e.mesh.material.dispose();
            }
            state.itemPickupEffects.splice(i, 1);
            continue;
        }

        if (!e.mesh) continue;

        const eased = Math.pow(tRaw, 0.55);
        const curPos = new THREE.Vector3().copy(e.startPos).lerp(target, eased);
        e.mesh.position.copy(curPos);
    }
}

export async function updateAmmoPickupEffects(dt) {
    if (!Array.isArray(state.ammoPickupEffects) || state.ammoPickupEffects.length === 0) return;
    if (!state.camera) return;

    const target = state.playerMesh ? state.playerMesh.position : state.camera.position;

    for (let i = state.ammoPickupEffects.length - 1; i >= 0; i--) {
        const e = state.ammoPickupEffects[i];
        e.age += dt;
        const tRaw = e.duration > 0 ? (e.age / e.duration) : 1;

        // 确保有 mesh 和 startPos 可以用于插值
        if (!e.mesh && e.pickup && e.pickup.mesh) {
            e.mesh = e.pickup.mesh;
        }
        if (!e.mesh) {
            state.ammoPickupEffects.splice(i, 1);
            continue;
        }
        if (!e.startPos) {
            e.startPos = e.mesh.position.clone();
        }

        if (tRaw >= 1) {
            // 特效到达玩家的一刻，真正结算弹药并移除拾取物
            if (e.pickup && state.ammoPickups && state.ammoPickups.includes(e.pickup) && !e.pickup._consumed) {
                const p = e.pickup;
                p._consumed = true; // 防止并发/多帧重复结算

                const before = state.reserveAmmo;
                const maxReserve = typeof state.maxReserveAmmo === 'number' ? state.maxReserveAmmo : CONFIG.totalAmmo;
                state.reserveAmmo = Math.min(state.reserveAmmo + p.amount, maxReserve);

                console.log('🟡 Ammo pickup', {
                    before,
                    picked: p.amount,
                    after: state.reserveAmmo,
                    maxReserve
                });

                // 拾取弹药额外奖励100货币
                state.currency += 100;

                // 先从场景和数组中移除该拾取物，确保后续帧不会再次处理它
                if (p.mesh) {
                    state.scene.remove(p.mesh);
                    p.mesh.geometry.dispose();
                    p.mesh.material.dispose();
                }
                const idx = state.ammoPickups.indexOf(p);
                if (idx !== -1) {
                    state.ammoPickups.splice(idx, 1);
                }

                // 再异步播放音效，避免在音效播放期间下一帧重复结算
                await playEquipSound();
            }

            // 无论是否成功结算，该特效都应结束
            state.ammoPickupEffects.splice(i, 1);
            continue;
        }

        // 位置插值：让特效朝玩家方向移动（快速起飞，稍后减速）
        const eased = Math.pow(tRaw, 0.55);
        const curPos = new THREE.Vector3().copy(e.startPos).lerp(target, eased);
        e.mesh.position.copy(curPos);
    }
}

export function spawnDroppedItem(item) {
    if (!state.scene || !state.playerBody) return;

    const pos = state.playerBody.position;
    const yaw = state.cameraYaw || 0;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    // 起始位置：玩家稍微前方、稍微抬起（抛出起点）
    const startPos = new THREE.Vector3(
        pos.x,
        pos.y + 0.8,
        pos.z
    );

    // 目标位置：玩家前方更远一点的位置（类似抛物线落地点）
    const targetXZ = new THREE.Vector3(
        pos.x + forward.x * 2.5,
        pos.y,
        pos.z + forward.z * 2.5
    );

    const dropPos = targetXZ.clone();

    // 简单射线检测：向下投射，找到最近的“地面”三角形，让掉落物贴近地面
    if (state.raycaster && Array.isArray(state.staticPhysicsMeshes) && state.staticPhysicsMeshes.length > 0) {
        const rayOrigin = new THREE.Vector3(dropPos.x, dropPos.y + 5, dropPos.z);
        const rayDir = new THREE.Vector3(0, -1, 0);
        state.raycaster.set(rayOrigin, rayDir);
        const hits = state.raycaster.intersectObjects(state.staticPhysicsMeshes, true);
        if (hits && hits.length > 0) {
            // 优先选择法线朝上的命中，尽量认为是“地面”而不是墙面
            let groundHit = null;
            for (const h of hits) {
                if (h.face && h.face.normal && h.face.normal.y > 0.6) {
                    groundHit = h;
                    break;
                }
            }
            const hit = groundHit || hits[0];
            // 贴得更近一点，略微抬高避免穿插
            dropPos.y = hit.point.y + 0.05;
        }
    }

    const geom = new THREE.BoxGeometry(0.35, 0.18, 0.35);

    // 掉落物颜色：优先按物品稀有度的颜色来渲染
    // item.rarity 由 stash.js 的 RARITY 提供，带有 color 字段（例如 '#9ca3af'）
    let dropColor = null;
    if (item && item.rarity && item.rarity.color) {
        dropColor = new THREE.Color(item.rarity.color);
    }

    // 如果没有稀有度信息，则回退到旧的按类型着色逻辑，保证兼容旧代码
    if (!dropColor) {
        let fallback = 0xFFD54F;
        if (item.type === 'med') fallback = 0x4ade80;       // 医疗：绿色
        else if (item.type === 'armor_kit') fallback = 0x60a5fa; // 护甲：蓝色
        dropColor = new THREE.Color(fallback);
    }

    const mat = new THREE.MeshStandardMaterial({ color: dropColor });
    const mesh = new THREE.Mesh(geom, mat);
    // 初始位置在起点，稍后在 updateDroppedItems 中做抛出插值
    mesh.position.copy(startPos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.droppedItem = { ...item };

    state.scene.add(mesh);

    if (!Array.isArray(state.droppedItems)) state.droppedItems = [];
    state.droppedItems.push({
        mesh,
        item: { ...item },
        lifeTime: 0,
        floatPhase: Math.random() * Math.PI * 2,
        baseY: dropPos.y,
        startPos: startPos.clone(),
        targetPos: dropPos.clone(),
        pickupDelay: 0.25,   // 至少飞一小段时间再允许拾取
        throwDuration: 0.25  // 抛出阶段时长
    });
}

function addItemToBackpack(item) {
    if (!state.backpack || !Array.isArray(state.backpack.slots)) return false;
    const slots = state.backpack.slots;

    // 简单背包：找到第一个空位放入完整物品实例
    for (let i = 0; i < slots.length; i++) {
        if (!slots[i]) {
            slots[i] = { ...item };
            return true;
        }
    }

    // 没有空位
    return false;
}

export function updateDroppedItems(dt) {
    if (!Array.isArray(state.droppedItems) || state.droppedItems.length === 0) return;
    if (!state.playerBody) return;
    const floatAmp = 0.12;
    const floatSpeed = 3.0;

    state.droppedItems = state.droppedItems.filter(entry => {
        const { mesh, item, baseY, startPos, targetPos, pickupDelay = 0.25, throwDuration = 0.25 } = entry;
        if (!mesh) return false;

        // 悬浮效果
        entry.lifeTime += dt;
        entry.floatPhase += dt * floatSpeed;
        const offsetY = Math.sin(entry.floatPhase) * floatAmp;

        // 抛出阶段：从 startPos 插值到 targetPos，并加入一个简单的抛物线高度
        if (startPos && targetPos && entry.lifeTime < throwDuration) {
            const t = Math.min(1, entry.lifeTime / throwDuration);
            const eased = t * (2 - t); // easeOutQuad
            const cur = new THREE.Vector3().copy(startPos).lerp(targetPos, eased);
            const arc = Math.sin(t * Math.PI) * 0.4; // 简单弧线高度
            cur.y += arc;
            mesh.position.copy(cur);
        } else {
            // 抛出结束后：围绕地面高度轻微上下浮动
            const groundY = typeof baseY === 'number' ? baseY : mesh.position.y;
            mesh.position.y = groundY + offsetY;
        }

        mesh.rotation.y += dt * 0.8;

        // 不再自动拾取，完全交给玩家按键交互处理
        return true;
    });
}

export function pickUpNearestDroppedItem() {
    if (!Array.isArray(state.droppedItems) || state.droppedItems.length === 0) return false;
    if (!state.camera || !state.interactionRaycaster) return false;

    const camera = state.camera;
    const origin = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    // 从相机中心向前发出一条射线，只检测当前所有掉落物的 mesh
    const meshes = state.droppedItems
        .map(e => e.mesh)
        .filter(m => !!m);
    if (meshes.length === 0) return false;

    state.interactionRaycaster.set(origin, dir);
    const hits = state.interactionRaycaster.intersectObjects(meshes, true);
    if (!hits || hits.length === 0) return false;

    const maxDistance = 3.0; // 最远可拾取距离
    const hit = hits[0];
    if (hit.distance > maxDistance) return false;

    // 找到对应的掉落条目
    const hitMesh = hit.object;
    const idx = state.droppedItems.findIndex(e => e.mesh === hitMesh || (e.mesh && hitMesh && (hitMesh === e.mesh || hitMesh.parent === e.mesh)));
    if (idx === -1) return false;

    const entry = state.droppedItems[idx];
    const item = entry.item ? { ...entry.item } : null;
    if (!item) return false;

    if (!addItemToBackpack(item)) {
        return false; // 背包满，拾取失败
    }

    // 移除世界中的 Mesh
    const m = entry.mesh;
    if (m) {
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
    }
    
    // 清理焦点图标
    if (entry._focusIcon) {
        if (entry._focusIcon.parent) entry._focusIcon.parent.remove(entry._focusIcon);
        if (entry._focusIcon.geometry) entry._focusIcon.geometry.dispose();
        if (entry._focusIcon.material) entry._focusIcon.material.dispose();
        entry._focusIcon = null;
    }

    state.droppedItems.splice(idx, 1);
    return true;
}

// 每帧轻量更新：根据相机朝向，找出视线前方最近的可交互物体
// 当前只考虑世界掉落物（state.droppedItems）
// 逻辑刻意保持简单：
//  - 每帧只选中一个物体作为 focusedInteractable
//  - 给它一个固定的浅色 emissive 高亮
//  - 在物体上方生成一个固定高度的小图标
//  - 不做任何时间/脉冲动画，避免闪烁和颜色抖动
export function updateInteractionFocus() {
    // 清理上一个高亮（掉落物 / 容器 的图标；掉落物仍恢复 emissive，容器不再改 emissive）
    const prev = state.focusedInteractable;
    if (prev) {
        if (prev.type === 'pickup' && prev.entry && prev.entry.mesh && prev.entry.mesh.material) {
            const pMesh = prev.entry.mesh;
            const pMat = pMesh.material;
            if (pMat && pMat.emissive && pMesh.userData._origEmissive !== undefined) {
                pMat.emissive.setHex(pMesh.userData._origEmissive);
            }
            if (prev.entry._focusIcon && prev.entry._focusIcon.parent) {
                prev.entry._focusIcon.parent.remove(prev.entry._focusIcon);
                if (prev.entry._focusIcon.geometry) prev.entry._focusIcon.geometry.dispose();
                if (prev.entry._focusIcon.material) prev.entry._focusIcon.material.dispose();
                prev.entry._focusIcon = null;
            }
        } else if (prev.type === 'container') {
            if (prev._focusIcon && prev._focusIcon.parent) {
                prev._focusIcon.parent.remove(prev._focusIcon);
                if (prev._focusIcon.geometry) prev._focusIcon.geometry.dispose();
                if (prev._focusIcon.material) prev._focusIcon.material.dispose();
                prev._focusIcon = null;
            }
        }
    }
    state.focusedInteractable = null;

    if (!state.camera || !state.interactionRaycaster) return;

    const camera = state.camera;
    const origin = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    const maxDistance = 3.0;
    state.interactionRaycaster.set(origin, dir);
    state.interactionRaycaster.far = maxDistance;

    // ---------- 1) 优先检测世界掉落物（保持原有行为） ----------
    if (Array.isArray(state.droppedItems) && state.droppedItems.length > 0) {
        const meshes = state.droppedItems
            .map(e => e.mesh)
            .filter(m => !!m);
        if (meshes.length > 0) {
            const hits = state.interactionRaycaster.intersectObjects(meshes, true);
            if (hits && hits.length > 0) {
                const hit = hits[0];
                if (hit.distance <= maxDistance) {
                    const hitMesh = hit.object;
                    const idx = state.droppedItems.findIndex(e => e.mesh === hitMesh || (e.mesh && hitMesh && (hitMesh === e.mesh || hitMesh.parent === e.mesh)));
                    if (idx !== -1) {
                        const entry = state.droppedItems[idx];
                        state.focusedInteractable = { type: 'pickup', entry };

                        const mesh = entry.mesh;
                        const mat = mesh && mesh.material;
                        if (mat && mat.emissive) {
                            if (mesh.userData._origEmissive === undefined) {
                                mesh.userData._origEmissive = mat.emissive.getHex();
                            }
                            mat.emissive.setHex(0x333333);

                            if (!entry._focusIcon) {
                                const iconGeom = new THREE.SphereGeometry(0.03, 8, 8);
                                const iconMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
                                entry._focusIcon = new THREE.Mesh(iconGeom, iconMat);
                                entry._focusIcon.userData._isFocusIcon = true;
                                state.scene.add(entry._focusIcon);
                            }

                            const iconOffset = 0.25;
                            entry._focusIcon.position.copy(mesh.position);
                            entry._focusIcon.position.y += iconOffset;
                        }
                        return; // 已找到掉落物，高亮并结束
                    }
                }
            }
        }
    }

    // ---------- 2) 若前方没有可拾取掉落物，再尝试检测简单容器 ----------
    if (!state.scene) return;

    const containerMeshes = [];
    state.scene.traverse(child => {
        if (child.isMesh && child.userData && child.userData.isContainer === true) {
            containerMeshes.push(child);
        }
    });
    if (containerMeshes.length === 0) return;

    const containerHits = state.interactionRaycaster.intersectObjects(containerMeshes, true);
    if (!containerHits || containerHits.length === 0) return;

    const ch = containerHits[0];
    if (ch.distance > maxDistance) return;

    // 找到被命中的容器根节点（允许我们后面扩展为多 mesh 组合）
    let node = ch.object;
    while (node && node.userData && node.userData.isContainer !== true) {
        node = node.parent;
    }
    if (!node || !node.userData || node.userData.isContainer !== true) return;

    state.focusedInteractable = {
        type: 'container',
        object: node,
        containerId: node.userData.containerId || null,
        containerType: node.userData.containerType || null,
        _focusIcon: null
    };

    // 容器只保留顶部的小圆点提示，不再修改材质 emissive
    const cMesh = node;
    if (!state.focusedInteractable._focusIcon) {
        const iconGeom = new THREE.SphereGeometry(0.06, 10, 10);
        const iconMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc }); // 浅蓝
        const icon = new THREE.Mesh(iconGeom, iconMat);
        icon.userData._isFocusIcon = true;
        state.focusedInteractable._focusIcon = icon;
        state.scene.add(icon);
    }

    const iconOffset = 0.6;
    state.focusedInteractable._focusIcon.position.copy(cMesh.position);
    state.focusedInteractable._focusIcon.position.y += iconOffset;
}

// 统一的 F 键交互入口：
//  - 目前只处理世界掉落物拾取
//  - 未来可以在这里按优先级增加：开箱子 / 对话 / 开门 等
export function handleUseKey() {
    // 1) 先尝试拾取世界掉落物（包括背包丢出的物品、ammo 类型物品等）
    if (pickUpNearestDroppedItem()) return true;

    // 2) 若当前聚焦目标是一个简单容器，则打开测试用容器界面
    const f = state.focusedInteractable;
    if (f && f.type === 'container') {
        // 使用 containerId 作为稳定 key：每个具体箱子只在第一次打开时 roll 一次内容
        const containerId = f.containerId || 'test_container';
        const containerType = f.containerType || 'defaultContainer';

        if (!state.containersById) state.containersById = {};

        let cached = state.containersById[containerId] || null;
        if (!cached) {
            // 第一次打开该箱子：根据类型与掉落表生成一次战利品，并缓存
            const loot = generateContainerLoot(containerType);
            cached = {
                id: containerId,
                name: '测试容器',
                type: containerType,
                maxSlots: loot.maxSlots,
                slots: loot.slots
            };
            state.containersById[containerId] = cached;
        }

        // 当前激活容器始终指向缓存对象，这样每次修改 slots 都会持久化到缓存
        state.activeContainer = cached;

        // 打开背包界面，此时容器区会根据 activeContainer 自动显示
        toggleBackpack(true);
        return true;
    }

    // 3) 其它交互类型可以在这里继续扩展
    return false;
}

export function updateEnvironmentSettings(difficulty = 'normal') {
    // 选择环境预设：根据难度配置不同的概率
    // Default (Normal): 70% day, 20% sunset, 10% night
    // Hard: 40% day, 30% sunset, 30% night
    // Insane: 0% day, 50% sunset, 50% night
    
    const r = Math.random();
    let mode = 'day';
    
    if (difficulty === 'insane') {
        if (r < 0.5) {
            mode = 'sunset';
        } else {
            mode = 'night';
        }
    } else if (difficulty === 'hard') {
        if (r < 0.4) {
            mode = 'day';
        } else if (r < 0.7) { // 0.4 + 0.3
            mode = 'sunset';
        } else {
            mode = 'night';
        }
    } else {
        // Normal (default)
        if (r < 0.7) {
            mode = 'day';
        } else if (r < 0.9) { // 0.7 + 0.2
            mode = 'sunset';
        } else {
            mode = 'night';
        }
    }
    
    state.environmentMode = mode;
    const envProfile = ENV_PROFILES[state.environmentMode] || ENV_PROFILES.day;

    // 轻量调试：在控制台打印当前环境模式
    console.log('🌗 New environment mode:', state.environmentMode, envProfile);

    // 更新雾参数
    if (state.scene.fog) {
        state.scene.fog.color = new THREE.Color(envProfile.fogColor);
    }

    // 更新天空盒材质（包含新的太阳/月亮）
    if (state.skyMesh && state.skyMesh.material) {
        const newFragmentShader = generateSkyShader(envProfile);
        state.skyMesh.material.fragmentShader = newFragmentShader;
        state.skyMesh.material.needsUpdate = true;
    }

    // 更新环境光
    state.scene.traverse((child) => {
        if (child instanceof THREE.HemisphereLight) {
            child.color = new THREE.Color(envProfile.ambSkyColor);
            child.groundColor = new THREE.Color(envProfile.ambGroundColor);
            child.intensity = envProfile.ambIntensity;
        }
        // 更新方向光（太阳/月亮）
        if (child instanceof THREE.DirectionalLight) {
            child.color = new THREE.Color(envProfile.dirColor);
            child.intensity = envProfile.dirIntensity;
            
            // 日落模式：方向光来自西边，与太阳位置一致
            if (state.environmentMode === 'sunset' && state.dirLightSunsetOffset) {
                child.position.copy(state.dirLightSunsetOffset);
            } else if (state.dirLightDefaultOffset) {
                child.position.copy(state.dirLightDefaultOffset);
            } else {
                child.position.set(80, 120, 50);
            }
            // 其他模式保持默认位置（在initGraphics中设置）
        }
    });

    updateSunShadowTarget(true);
}

function updateSunShadowTarget(forceLog = false) {
    if (!state.dirLight || !state.playerBody) return;

    const targetPos = state.playerBody.position;
    const offset = state.environmentMode === 'sunset'
        ? state.dirLightSunsetOffset
        : state.dirLightDefaultOffset;

    if (offset) {
        state.dirLight.position.copy(targetPos).add(offset);
    }

    state.dirLight.target.position.copy(targetPos);
    state.dirLight.target.updateMatrixWorld();
    state.dirLight.shadow.camera.updateMatrixWorld();

    if (forceLog) {
        console.log('☀️ Directional light retargeted:', {
            env: state.environmentMode,
            lightPos: state.dirLight.position.toArray(),
            target: state.dirLight.target.position.toArray()
        });
    }
}

export function buildLevel(difficulty = 'normal') {
    const buildStart = performance.now();
    console.log(`🏗️ buildLevel: 开始构建随机地图 (难度: ${difficulty})...`);

    // 更新环境设置（随机天空模式）
    updateEnvironmentSettings(difficulty);

    // 清空静态物理网格引用，避免已销毁的 mesh 残留导致空气墙
    state.staticPhysicsMeshes.length = 0;

    // 根据城市街区配置动态计算地板/碰撞网格尺寸
    const tSizeStart = performance.now();
    const { blockSize, roadWidth, gridSize } = CITY_GRID_CONFIG;
    const cityTotalSize = gridSize * (blockSize + roadWidth) - roadWidth;
    const cityHalfSize = cityTotalSize / 2;
    const tSizeEnd = performance.now();

    // 使用真实城市尺寸重设碰撞网格世界范围
    const tGridResizeStart = performance.now();
    if (collisionGrid && typeof collisionGrid.resizeWorld === 'function') {
        collisionGrid.resizeWorld(cityTotalSize);
    } else {
        // 旧版本兼容：至少清空一次
        collisionGrid.clear();
    }
    const tGridResizeEnd = performance.now();
    
    // 重置动态刷怪状态
    if (state.usedSpawnPointIndices) {
        state.usedSpawnPointIndices.clear();
    }
    state.enemySpawnIndices = [];
    
    // 每次构建关卡时创建新的地图生成器实例，确保新的随机种子
    const tMapGenStart = performance.now();
    const mapGenerator = createMapGenerator();
    const tMapGenEnd = performance.now();
    console.log(`🎲 buildLevel: 新的地图生成器已创建，种子: ${mapGenerator.seed.toFixed(2)}, 耗时=${(tMapGenEnd - tMapGenStart).toFixed(2)}ms`);
    
    // 生成随机地图配置
    const tMapCfgStart = performance.now();
    const mapConfig = mapGenerator.generateMapConfig();
    const tMapCfgEnd = performance.now();
    console.log(`🧩 buildLevel: 生成地图配置耗时=${(tMapCfgEnd - tMapCfgStart).toFixed(2)}ms`);
    
    // 保存地图配置供其他函数使用
    state.currentMapConfig = mapConfig;
    
    const tFloorStart = performance.now();
    const floorShape = new CANNON.Box(new CANNON.Vec3(cityHalfSize, 0.05, cityHalfSize));
    const floorBody = new CANNON.Body({ 
        mass: 0, 
        material: state.physicsMaterial,
        collisionFilterGroup: state.collisionGroups.STATIC,
        // 地面仅与玩家/敌人碰撞，不与其他静态刚体发生碰撞检测
        collisionFilterMask: state.collisionGroups.PLAYER | state.collisionGroups.ENEMY
    });
    floorBody.addShape(floorShape);
    floorBody.position.set(0, -0.05, 0); // 与视觉体位置对齐
    state.world.addBody(floorBody);
    state.spawnPoints.length = 0;


    const floorSize = cityHalfSize * 2;
    // 使用BoxGeometry而不是PlaneGeometry，确保射线检测正常工作
    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(floorSize, 0.1, floorSize), state.mats.floor);
    floorMesh.position.y = -0.05; // 稍微下沉，使顶部与Y=0对齐
    floorMesh.receiveShadow = true;
    state.mats.floor.map.repeat.set(cityHalfSize / 5, cityHalfSize / 5);
    
    // 添加静态标记和边界信息
    floorMesh.userData.isStatic = true;
    floorMesh.userData.isDynamic = false;
    floorMesh.userData.bounds = {x: 0, z: 0, width: floorSize, depth: floorSize, height: 0};
    floorMesh.userData.canDebris = true;
    floorMesh.userData.isActive = true; // 默认激活
    floorMesh.userData.debrisColor = state.mats.floor.userData.debrisColor || 0x888888;
    floorMesh.userData.debrisCount = 5;
    floorMesh.userData.debrisMultiplier = 1;
    floorMesh.userData.physicsBody = floorBody; // Hack for hit detection logic
    floorMesh.userData.hasPhysicsBody = true;
    // 地板始终保持物理激活，不参与100米动态启用/禁用逻辑
    floorMesh.userData.alwaysActivePhysics = true;
    if (state.staticPhysicsMeshes) {
        state.staticPhysicsMeshes.push(floorMesh);
    }
    // 让基础地面也加入碰撞网格，供射线检测/生成点等系统统一使用
    collisionGrid.addStaticObject(floorMesh);
    state.scene.add(floorMesh);
    
    const tFloorEnd = performance.now();
    // 验证地板是否正确添加
    console.log('🏗️ 地板创建完成:', {
        位置: `(${floorMesh.position.x.toFixed(2)}, ${floorMesh.position.y.toFixed(2)}, ${floorMesh.position.z.toFixed(2)})`,
        大小: `${floorSize}x${floorSize}`,
        isStatic: floorMesh.userData.isStatic,
        场景中物体数: state.scene.children.length,
        耗时: `${(tFloorEnd - tFloorStart).toFixed(2)}ms`
    });

    // 使用新的街区网格城市生成器构建世界
    console.log('🏗️ 使用街区网格系统构建城市...');
    const tCityStart = performance.now();
    generateCityScene();
    const tCityEnd = performance.now();
    console.log(`🏙️ buildLevel: 城市几何生成耗时=${(tCityEnd - tCityStart).toFixed(2)}ms`);

    // 在城市完全生成后，对静态几何进行保守的渲染合批
    const tBatchStart = performance.now();
    batchStaticBoxes();
    const tBatchEnd = performance.now();
    console.log(`📦 buildLevel: 静态几何合批耗时=${(tBatchEnd - tBatchStart).toFixed(2)}ms`);

    // 关卡构建完成后，收集所有老的静态 Mesh（非合批 proxy），用于渲染范围管理
    state.staticRenderPool.length = 0;
    state.scene.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.userData) return;
        const ud = obj.userData;
        if (!ud.isStatic) return;
        if (ud.isBatchedProxy) return;
        // 将地板/道路等 alwaysActivePhysics 的静态物体也纳入池中，
        // 这样它们可以出现在 activeStaticMeshes 里，供子弹射线命中和掉渣使用。
        state.staticRenderPool.push(obj);
        // 初始时老 mesh 都在场景中
        ud.inRenderScene = true;
    });
    
    const tSpawnGridStart = performance.now();
    registerSafeSpawnGrid();
    const tSpawnGridEnd = performance.now();
    console.log(`📍 buildLevel: 生成点采样网格耗时=${(tSpawnGridEnd - tSpawnGridStart).toFixed(2)}ms`);
    // 在采样完成后，预先从全图选出固定的敌人刷怪点
    const tPreSpawnStart = performance.now();
    preselectEnemySpawnPoints();
    const tPreSpawnEnd = performance.now();
    console.log(`👾 buildLevel: 预选敌人刷怪点耗时=${(tPreSpawnEnd - tPreSpawnStart).toFixed(2)}ms`);
    
    // 设置玩家出生点（在生成点注册之后，使用种子随机）
    const tPlayerSpawnStart = performance.now();
    setRandomPlayerSpawn(mapGenerator.random);
    const tPlayerSpawnEnd = performance.now();
    console.log(`🎮 buildLevel: 设置玩家出生点耗时=${(tPlayerSpawnEnd - tPlayerSpawnStart).toFixed(2)}ms`);
    
    // 输出碰撞网格统计信息
    const stats = collisionGrid.getStats();
    console.log(`📊 碰撞网格统计:`, stats);
    
    // 测试：统计静态/动态物体数量
    let staticCount = 0, dynamicCount = 0;
    state.scene.traverse((child) => {
        if (child.isMesh) {
            if (child.userData.isStatic) staticCount++;
            if (child.userData.isDynamic) dynamicCount++;
        }
    });
    console.log(`🏷️ 物体标记统计: 静态物体=${staticCount}, 动态物体=${dynamicCount}`);
    
    // 定期监控物体标记变化（轻量统计）
    setInterval(() => {
        const t0 = performance.now();
        // 静态物体数量：场景中带 isStatic 标记的 Mesh
        let staticCount = 0;
        let totalMeshes = 0;
        state.scene.traverse((child) => {
            if (child.isMesh) {
                totalMeshes++;
                if (child.userData && child.userData.isStatic) {
                    staticCount++;
                }
            }
        });
        const t1 = performance.now();

        // 敌人和动态物体数量：直接使用已有状态集合，避免在场景中重复查找
        const enemyCount = Array.isArray(state.enemies) ? state.enemies.length : 0;
        const hasPlayer = !!state.playerMesh;
        const dynamicCount = enemyCount + (hasPlayer ? 1 : 0);

        // 老静态 mesh 渲染池规模 & 当前在 scene 中的数量
        let poolSize = 0;
        let poolInScene = 0;
        if (state.staticRenderPool && Array.isArray(state.staticRenderPool)) {
            poolSize = state.staticRenderPool.length;
            for (const m of state.staticRenderPool) {
                if (m && m.userData && m.userData.inRenderScene) {
                    poolInScene++;
                }
            }
        }

        const traverseCost = (t1 - t0).toFixed(3);
        console.log(
            `🏷️ 定期统计: 场景子节点=${state.scene.children.length}, Mesh总数=${totalMeshes}, 静态Mesh=${staticCount}, ` +
            `动态(玩家+敌人)=${dynamicCount}, 敌人=${enemyCount}, staticRenderPool={总数:${poolSize}, 在scene:${poolInScene}}, traverse耗时=${traverseCost}ms`
        );
    }, 10000); // 每10秒输出一次
    
    const buildEnd = performance.now();
    console.log(`✅ 随机地图构建完成！总耗时=${(buildEnd - buildStart).toFixed(2)}ms`, {
        cityTotalSize,
        gridSize,
        blockSize,
        roadWidth,
        计算城市尺寸: `${(tSizeEnd - tSizeStart).toFixed(2)}ms`,
        重设碰撞网格: `${(tGridResizeEnd - tGridResizeStart).toFixed(2)}ms`,
        地板创建: `${(tFloorEnd - tFloorStart).toFixed(2)}ms`,
        城市生成: `${(tCityEnd - tCityStart).toFixed(2)}ms`,
        静态合批: `${(tBatchEnd - tBatchStart).toFixed(2)}ms`,
        生成点采样: `${(tSpawnGridEnd - tSpawnGridStart).toFixed(2)}ms`,
        敌人刷怪点预选: `${(tPreSpawnEnd - tPreSpawnStart).toFixed(2)}ms`,
        玩家出生点: `${(tPlayerSpawnEnd - tPlayerSpawnStart).toFixed(2)}ms`
    });
    
    // 首次进入页面或其他使用场景：通知全局加载遮罩可以淡出
    hideGlobalLoading();
}

// 基于玩家位置，动态启用/禁用静态建筑/掩体的物理刚体
// 优化：按固定时间间隔执行一次，而不是按渲染帧数
let staticPhysicsAccumTime = 0;
// 将更新拆成更小的批处理间隔，通过自适应批大小保证约2秒完成一整圈
const STATIC_PHYSICS_UPDATE_INTERVAL = 0.1; // 秒，每0.1秒处理一批
const STATIC_PHYSICS_FULL_CYCLE = 2.0; // 期望完整遍历所有静态物体所需时间（秒）
// 🆕 使用游标 + 批处理，避免在同一帧处理过多静态物体导致掉帧
let staticPhysicsCursor = 0;
const STATIC_PHYSICS_MAX_PER_UPDATE = 200; // 基础批大小下限
let staticPhysicsFirstFullApplied = false; // 首次进入地图时先完整跑一遍，保持旧行为
const STATIC_RENDER_RADIUS = 200; // 老静态 mesh 渲染半径（米）
const STATIC_RENDER_RADIUS_SQ = STATIC_RENDER_RADIUS * STATIC_RENDER_RADIUS;
const STATIC_SHADOW_RADIUS = 200; // 静态物体投射阴影半径（米）
const STATIC_SHADOW_RADIUS_SQ = STATIC_SHADOW_RADIUS * STATIC_SHADOW_RADIUS;

// 导出重置函数，允许外部重置累计时间
export function resetStaticPhysicsAccumTime() {
    staticPhysicsAccumTime = 0;
}
export function updateStaticPhysicsAroundPlayer(dt) {
    // 使用累计时间控制执行频率，避免受 FPS 影响
    staticPhysicsAccumTime += dt;
    if (staticPhysicsAccumTime < STATIC_PHYSICS_UPDATE_INTERVAL) return;
    staticPhysicsAccumTime = 0;

    if (!state.world || !state.playerBody || !state.scene) return;

    updateSunShadowTarget();

    const playerPos = state.playerBody.position;
    const physicsRadius = 100; // 刚体物理激活半径（米）
    const physicsRadiusSq = physicsRadius * physicsRadius;
    const raycastRadius = 200; // 射线检测/掉渣激活半径（米）
    const raycastRadiusSq = raycastRadius * raycastRadius;

    const staticMeshes = state.staticRenderPool && state.staticRenderPool.length > 0
        ? state.staticRenderPool
        : [];

    const total = staticMeshes.length;
    if (total === 0) return;

    // 自适应批大小：保证在 STATIC_PHYSICS_FULL_CYCLE 时间内大致遍历一整圈
    const fractionPerCall = STATIC_PHYSICS_UPDATE_INTERVAL / STATIC_PHYSICS_FULL_CYCLE;
    let adaptivePerUpdate = Math.ceil(total * fractionPerCall);
    adaptivePerUpdate = Math.max(1, Math.min(total, adaptivePerUpdate));

    let maxPerUpdate = Math.min(STATIC_PHYSICS_MAX_PER_UPDATE, total);

    // 首次：完整跑一圈，保持与旧版本一致的初始效果
    if (!staticPhysicsFirstFullApplied) {
        maxPerUpdate = total;
        staticPhysicsFirstFullApplied = true;
    } else {
        // 之后：在基础批大小与自适应值之间取较大者，避免大地图遍历过慢
        maxPerUpdate = Math.max(maxPerUpdate, adaptivePerUpdate);
    }

    let processed = 0;

    // 使用游标从上次结束的位置继续，避免每次都从0开始
    while (processed < maxPerUpdate) {
        const index = staticPhysicsCursor % total;
        const mesh = staticMeshes[index];
        staticPhysicsCursor = (staticPhysicsCursor + 1) % total;
        processed++;

        const ud = mesh.userData;

        // 地板/街道等标记为 alwaysActivePhysics 的物体：始终保持 isActive = true，确保射线和掉渣永远生效
        if (ud.alwaysActivePhysics) {
            ud.isActive = true;
            // 物理刚体也保持激活（下面物理逻辑会跳过 alwaysActivePhysics）
            continue;
        }

        const dx = mesh.position.x - playerPos.x;
        const dz = mesh.position.z - playerPos.z;
        const distSq = dx * dx + dz * dz;
        const inRayRange = distSq <= raycastRadiusSq;
        const inPhysicsRange = distSq <= physicsRadiusSq;
        const inRenderRange = distSq <= STATIC_RENDER_RADIUS_SQ;
        const inShadowRange = distSq <= STATIC_SHADOW_RADIUS_SQ;

        // 射线/掉渣使用的激活标记：使用更大的 200 米范围
        ud.isActive = inRayRange;

        // 渲染范围管理：仅在一定半径内保留老静态 mesh 在场景中
        if (!ud.inRenderScene && inRenderRange) {
            state.scene.add(mesh);
            ud.inRenderScene = true;
        } else if (ud.inRenderScene && !inRenderRange) {
            state.scene.remove(mesh);
            ud.inRenderScene = false;
        }

        // 阴影范围管理：仅在一定半径内让静态物体参与阴影投射
        if (mesh.castShadow !== undefined) {
            mesh.castShadow = inShadowRange;
        }

        // 仅对具有物理刚体且不标记 alwaysActivePhysics 的物体做刚体启停
        if (ud.hasPhysicsBody && !ud.alwaysActivePhysics) {
            const body = ud.physicsBody;
            if (!body) continue;

            if (ud.inPhysicsWorld === undefined) {
                // 通过 body.world 判断初始是否已在物理世界中，支持惰性激活
                ud.inPhysicsWorld = !!body.world;
            }

            if (inPhysicsRange && !ud.inPhysicsWorld) {
                state.world.addBody(body);
                ud.inPhysicsWorld = true;
            } else if (!inPhysicsRange && ud.inPhysicsWorld) {
                state.world.removeBody(body);
                ud.inPhysicsWorld = false;
            }
        }
    }

    // 维护活跃静态物体数组（用于射线检测优化）
    state.activeStaticMeshes.length = 0; // 清空数组
    for (const mesh of staticMeshes) {
        if (mesh.userData && mesh.userData.isActive) {
            state.activeStaticMeshes.push(mesh);
        }
    }
}

// 对静态几何进行保守的渲染层合批：
// - 只处理 isStatic 且非动态、非道路/地板、非透明、未显式跳过的 Mesh
// - 按材质实例 + 贴图 repeat 分组
// - 将每组几何变换到世界空间后 merge 成一个 Mesh 作为渲染代理
// - 原始 Mesh 不从场景移除，仅关闭可见性和阴影，以保持物理和射线逻辑不变
function batchStaticBoxes() {
    if (!state.scene) return;

    const startTime = performance.now();
    let scanned = 0;
    let eligible = 0;
    let skippedStatic = 0;

    // 确保世界矩阵是最新的
    state.scene.updateWorldMatrix(true, true);

    const groups = new Map();
    const CHUNK_SIZE = 1200;
    const tempWorldPos = new THREE.Vector3();

    state.scene.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.userData) return;
        scanned++;

        const ud = obj.userData;
        if (!ud.isStatic) return;

        // 只统计静态 Mesh 的跳过原因，便于调试
        const isDynamic = !!ud.isDynamic;
        const skipFlag = !!ud.skipBatch;
        const alwaysActive = !!ud.alwaysActivePhysics;

        const mat = obj.material;
        const isArrayMat = Array.isArray(mat);
        const isTransparent = !!(mat && mat.transparent);
        const isRoadOrFloor = (mat === state.mats.road || mat === state.mats.floor);

        const geo = obj.geometry;
        const hasBufferGeo = !!(geo && geo.isBufferGeometry);
        const isSupportedGeo = hasBufferGeo && (geo.type === 'BoxGeometry' || geo.type === 'BufferGeometry');

        if (
            isDynamic ||
            skipFlag ||
            alwaysActive ||
            !mat ||
            isArrayMat ||
            isTransparent ||
            isRoadOrFloor ||
            !hasBufferGeo ||
            !isSupportedGeo
        ) {
            skippedStatic++;
            return;
        }

        eligible++;

        // 生成分组键：材质实例 + 贴图 repeat（如果存在）+ 区块坐标
        let repeatKey = 'norepeat';
        const map = mat.map;
        if (map && map.repeat) {
            repeatKey = `${map.repeat.x.toFixed(3)}_${map.repeat.y.toFixed(3)}`;
        }

        tempWorldPos.setFromMatrixPosition(obj.matrixWorld);
        const chunkX = Math.floor(tempWorldPos.x / CHUNK_SIZE);
        const chunkZ = Math.floor(tempWorldPos.z / CHUNK_SIZE);
        const chunkKey = `${chunkX},${chunkZ}`;

        const key = `${mat.uuid}|${repeatKey}|${chunkKey}`;
        if (!groups.has(key)) {
            groups.set(key, { material: mat, geometries: [], meshes: [] });
        }
        const group = groups.get(key);

        // 将几何克隆并变换到世界空间，供 merge 使用
        const worldGeo = geo.clone();
        worldGeo.applyMatrix4(obj.matrixWorld);
        group.geometries.push(worldGeo);
        group.meshes.push(obj);
    });

    let proxyCount = 0;
    let mergedGroupCount = 0;

    for (const [, group] of groups) {
        const { material, geometries, meshes } = group;
        if (!geometries || geometries.length <= 1) continue; // 一两个没必要合批

        try {
            const merged = BufferGeometryUtils.mergeBufferGeometries(geometries, false);
            if (!merged) continue;

            mergedGroupCount++;

            // 合批后的代理 Mesh：只负责渲染，不参与物理/命中
            const proxy = new THREE.Mesh(merged, material);
            proxy.castShadow = true;
            proxy.receiveShadow = true;
            proxy.userData.isStatic = true;
            proxy.userData.isDynamic = false;
            proxy.userData.isBatchedProxy = true;
            proxy.userData.canDebris = false; // 避免进入子弹候选集
            proxy.userData.skipBatch = true;   // 后续不要再尝试对它合批

            state.scene.add(proxy);
            proxyCount++;

            // 原始 Mesh 保留在场景中供物理与射线使用，但关闭渲染
            for (const m of meshes) {
                if (!m || !m.userData) continue;
                m.visible = false;
                m.castShadow = false;
                m.receiveShadow = false;
            }
        } catch (e) {
            console.warn('batchStaticBoxes: merge failed for material', material, e);
        }
    }

    const endTime = performance.now();
    const cost = (endTime - startTime).toFixed(2);

    console.log(`📦 batchStaticBoxes: 扫描 Mesh=${scanned}, 静态候选=${eligible}, 跳过静态=${skippedStatic}, 分组数(材质×区块)=${groups.size}, 合批组数=${mergedGroupCount}, 生成代理Mesh=${proxyCount}, 区块边长=${CHUNK_SIZE}, 耗时=${cost}ms`);
}





// 检查位置是否与建筑碰撞（使用网格优化）
function checkBuildingCollision(x, z, buffer = 2) {
    // 使用碰撞网格系统进行高效检测
    return collisionGrid.checkStaticCollision(x, z, buffer * 2, buffer * 2);
}

// 设置随机出生点
function setRandomPlayerSpawn(randomFunc = null) {
    // 🆕 使用统一的生成点系统，大幅扩大中心区域选择范围
    const centerSafeRadius = 80; // 从50米增加到80米，提供大量选择
    
    console.log(`🎮 开始设置玩家出生点，总生成点数: ${state.spawnPoints.length}`);
    
    // 从spawnPoints中筛选出中心区域内的点
    const centerSpawnPoints = state.spawnPoints.filter(point => {
        const dist = Math.sqrt(point.x * point.x + point.z * point.z);
        return dist <= centerSafeRadius;
    });
    
    console.log(`🎮 中心${centerSafeRadius}米半径内的安全生成点: ${centerSpawnPoints.length}个`);
    
    if (centerSpawnPoints.length === 0) {
        console.warn('⚠️ 中心区域内没有安全的生成点，使用默认位置');
        state.playerBody.position.set(0, 10, 0);
        return;
    }
    
    // 使用提供的随机函数或默认Math.random
    const random = randomFunc || Math.random;
    
    // 使用种子随机选择一个中心区域内的生成点
    const randomIndex = Math.floor(random() * centerSpawnPoints.length);
    const spawnPoint = centerSpawnPoints[randomIndex];
    
    // 设置玩家位置（稍微提高高度确保安全着地）
    state.playerBody.position.set(spawnPoint.x, 10, spawnPoint.z);
    
    console.log(`🎮 玩家出生点: (${spawnPoint.x.toFixed(1)}, 10, ${spawnPoint.z.toFixed(1)}) [从${centerSpawnPoints.length}个中心安全点中选择]`);
}

// 导出到全局供main.js使用
window.setRandomPlayerSpawn = setRandomPlayerSpawn;

// 检查位置是否安全（无建筑碰撞）
function isSafeSpawnPosition(x, z) {
    // 移除中心开放区域限制，允许在中心区域生成
    // 只检查建筑碰撞，中心开放区域通常是安全的
    
    // 检查建筑碰撞
    if (checkBuildingCollision(x, z, 3)) {
        return false;
    }
    
    return true;
}

// 暴露到全局供其他模块使用
window.isSafeSpawnPosition = isSafeSpawnPosition;
window.checkBuildingCollision = checkBuildingCollision;



const MAX_DEBRIS_INSTANCES = 2000;
const _debrisTmpPos = new THREE.Vector3();
const _debrisTmpQuat = new THREE.Quaternion();
const _debrisTmpScale = new THREE.Vector3();
const _debrisTmpMatrix = new THREE.Matrix4();

function ensureDebrisInstancedMesh() {
    if (state.debrisInstancedMesh) return state.debrisInstancedMesh;

    const baseSize = 0.05;
    const geo = new THREE.BoxGeometry(baseSize, baseSize, baseSize);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    // 关闭 toneMapping，避免实例颜色在后处理中被挤压得过暗
    mat.toneMapped = false;
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_DEBRIS_INSTANCES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 为几何体补一层常量白色的 vertex color，这样 shader 中的 vColor 不为 0，
    // instanceColor 叠乘时才不会被抹成黑色
    const vertexCount = geo.attributes.position.count;
    const white = new Float32Array(vertexCount * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
    // 显式为几何挂载 instanceColor attribute，确保着色器能正确读取每个实例颜色
    const colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS_INSTANCES * 3), 3);
    geo.setAttribute('instanceColor', colors);
    mesh.instanceColor = colors;
    mesh.renderOrder = 100;
    state.scene.add(mesh);

    state.debrisInstancedMesh = mesh;
    state.debrisNextIndex = 0;
    if (!Array.isArray(state.debrisPool)) {
        state.debrisPool = [];
    }

    return mesh;
}

// 根据当前环境光调整掉渣颜色
function getEnvironmentAwareDebrisColor(baseColor) {
    const envProfile = ENV_PROFILES[state.environmentMode] || ENV_PROFILES.day;
    const baseColorObj = new THREE.Color(baseColor);
    
    // 根据环境模式调整颜色
    if (state.environmentMode === 'night') {
        // 夜晚：掉渣变冷色调，降低亮度
        const nightTint = new THREE.Color(envProfile.ambSkyColor);
        nightTint.multiplyScalar(0.3); // 减弱影响
        baseColorObj.lerp(nightTint, 0.4); // 40% 混合夜晚色调
        baseColorObj.multiplyScalar(0.7); // 降低30%亮度
    } else if (state.environmentMode === 'sunset') {
        // 晚霞：掉渣变暖色调，橙红色调
        const sunsetTint = new THREE.Color(envProfile.dirColor);
        sunsetTint.multiplyScalar(0.2); // 减弱影响
        baseColorObj.lerp(sunsetTint, 0.3); // 30% 混合晚霞色调
        baseColorObj.multiplyScalar(0.8); // 降低20%亮度
    } else {
        // 白天：保持原色但稍微降低亮度避免bloom
        baseColorObj.multiplyScalar(0.9);
    }
    
    return baseColorObj;
}

export function spawnDebris(point, normal, color, count = 5, sizeMultiplier = 1) {
    const mesh = ensureDebrisInstancedMesh();
    const scatter = Math.min(0.12 + count * 0.01, 0.45);
    const randVelRange = Math.min(2.5 + count * 0.08, 5.5);

    for (let i = 0; i < count; i++) {
        let slot;

        if (state.debrisPool.length < MAX_DEBRIS_INSTANCES) {
            const index = state.debrisPool.length;
            slot = {
                index,
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                scale: 1,
                rotX: 0,
                rotZ: 0,
                life: 0,
                active: false
            };
            state.debrisPool.push(slot);
        } else {
            const next = state.debrisNextIndex || 0;
            slot = state.debrisPool[next];
            state.debrisNextIndex = (next + 1) % MAX_DEBRIS_INSTANCES;
        }

        const scale = (0.8 + Math.random() * 0.4) * sizeMultiplier;
        slot.scale = scale;
        slot.position.copy(point);
        slot.position.x += (Math.random() - 0.5) * scatter;
        slot.position.y += (Math.random() - 0.5) * scatter;
        slot.position.z += (Math.random() - 0.5) * scatter;

        const vel = slot.velocity;
        vel.copy(normal).multiplyScalar(2 + Math.random() * 3);
        vel.x += (Math.random() - 0.5) * randVelRange;
        vel.y += (Math.random() - 0.5) * randVelRange;
        vel.z += (Math.random() - 0.5) * randVelRange;

        slot.rotX = 0;
        slot.rotZ = 0;
        slot.life = 20.0;
        slot.active = true;

        const colorObj = getEnvironmentAwareDebrisColor(color);
        mesh.setColorAt(slot.index, colorObj);

        if (!state._debrisColorDebugLogged) {
            state._debrisColorDebugLogged = true;
            console.log('spawnDebris debug:', {
                rawColor: color,
                colorHex: typeof color === 'number' ? '0x' + color.toString(16) : color,
                instanceIndex: slot.index,
                instanceColorArraySample: mesh.instanceColor && mesh.instanceColor.array
                    ? Array.from(mesh.instanceColor.array.slice(0, 6))
                    : null
            });
        }

        _debrisTmpPos.copy(slot.position);
        _debrisTmpQuat.setFromEuler(new THREE.Euler(slot.rotX, 0, slot.rotZ));
        _debrisTmpScale.set(slot.scale, slot.scale, slot.scale);
        _debrisTmpMatrix.compose(_debrisTmpPos, _debrisTmpQuat, _debrisTmpScale);
        mesh.setMatrixAt(slot.index, _debrisTmpMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
    }
}

export function updateDebris(dt) {
    const mesh = state.debrisInstancedMesh;
    if (!mesh || !Array.isArray(state.debrisPool) || state.debrisPool.length === 0) return;

    let matrixDirty = false;

    for (let i = 0; i < state.debrisPool.length; i++) {
        const d = state.debrisPool[i];
        if (!d.active) continue;

        d.life -= dt;
        if (d.life <= 0) {
            d.active = false;
            _debrisTmpPos.set(0, -9999, 0);
            _debrisTmpQuat.identity();
            _debrisTmpScale.set(0, 0, 0);
            _debrisTmpMatrix.compose(_debrisTmpPos, _debrisTmpQuat, _debrisTmpScale);
            mesh.setMatrixAt(d.index, _debrisTmpMatrix);
            matrixDirty = true;
            continue;
        }

        d.velocity.y -= 9.8 * dt;
        _debrisTmpPos.copy(d.position).addScaledVector(d.velocity, dt);

        if (_debrisTmpPos.y < 0) {
            _debrisTmpPos.y = 0;
            d.velocity.y *= -0.5;
            d.velocity.x *= 0.8;
            d.velocity.z *= 0.8;
        }

        d.position.copy(_debrisTmpPos);
        d.rotX += d.velocity.z * dt;
        d.rotZ -= d.velocity.x * dt;

        _debrisTmpQuat.setFromEuler(new THREE.Euler(d.rotX, 0, d.rotZ));
        _debrisTmpScale.set(d.scale, d.scale, d.scale);
        _debrisTmpMatrix.compose(d.position, _debrisTmpQuat, _debrisTmpScale);
        mesh.setMatrixAt(d.index, _debrisTmpMatrix);
        matrixDirty = true;
    }

    if (matrixDirty) {
        mesh.instanceMatrix.needsUpdate = true;
    }
}

export function createAmmoPickup(position, amount = null) {
    // 如果没有指定数量，则计算为30%的备弹上限
    if (amount === null) {
        const maxReserve = typeof state.maxReserveAmmo === 'number' ? state.maxReserveAmmo : CONFIG.totalAmmo;
        amount = Math.floor(maxReserve * 0.3);
    }
    
    const geo = new THREE.BoxGeometry(0.4, 0.2, 0.4);
    const mat = state.mats.ammo || (state.mats.ammo = new THREE.MeshStandardMaterial({
        color: 0xffd54f,
        emissive: 0xffeb3b,
        emissiveIntensity: 0.6
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position.x, 0.25, position.z);
    mesh.castShadow = true;
    state.scene.add(mesh);
    state.ammoPickups.push({ mesh, amount });
}

export async function updateAmmoPickups(dt) {
    for (let i = state.ammoPickups.length - 1; i >= 0; i--) {
        const p = state.ammoPickups[i];
        p.mesh.rotation.y += dt * 2;

        const dx = state.playerBody.position.x - p.mesh.position.x;
        const dz = state.playerBody.position.z - p.mesh.position.z;
        const dy = state.playerBody.position.y - p.mesh.position.y;
        const distSq = dx * dx + dz * dz;

        // 当玩家进入 4 米范围时开始触发“子弹吸附”特效，但此时还不真正加子弹
        if (distSq < 4 * 4 && Math.abs(dy) < 2.0) {
            if (!p.isPulling) {
                p.isPulling = true;
                if (!Array.isArray(state.ammoPickupEffects)) {
                    state.ammoPickupEffects = [];
                }
                state.ammoPickupEffects.push({
                    position: p.mesh.position.clone(),
                    age: 0,
                    duration: 0.25,
                    pickup: p
                });
            }
        }
    }
}

export function resetWorldRuntime() {
    console.log('🧹 开始清理世界运行时对象...');
    
    // 清空静态物理网格引用，避免已销毁的 mesh 残留导致空气墙
    state.staticPhysicsMeshes.length = 0;
    
    // 清空碎片（InstancedMesh 实现）
    if (state.debrisInstancedMesh) {
        state.scene.remove(state.debrisInstancedMesh);
        state.debrisInstancedMesh.geometry.dispose();
        state.debrisInstancedMesh.material.dispose();
        state.debrisInstancedMesh = null;
    }
    if (Array.isArray(state.debrisPool)) {
        state.debrisPool.length = 0;
    }
    state.debrisNextIndex = 0;
    console.log('✅ 清理了碎片 InstancedMesh 和碎片池');

    // 清空地上的弹药箱
    for (let i = state.ammoPickups.length - 1; i >= 0; i--) {
        const p = state.ammoPickups[i];
        if (p.mesh) {
            state.scene.remove(p.mesh);
        }
    }
    state.ammoPickups.length = 0;
    console.log(`✅ 清理了 ${state.ammoPickups.length} 个弹药箱`);

    // 清理城市场景对象（建筑物、道路、道具等）
    let removedCount = 0;
    for (let i = state.scene.children.length - 1; i >= 0; i--) {
        const object = state.scene.children[i];
        
        // 保留必要的对象（玩家、天空、灯光、地面）
        if (object.userData.isPlayer || 
            object === state.skyMesh ||
            object instanceof THREE.Light ||
            object instanceof THREE.HemisphereLight ||
            object instanceof THREE.DirectionalLight ||
            (object.material === state.mats.floor && object.geometry instanceof THREE.BoxGeometry)) {
            continue;
        }
        
        // 清理物理体
        if (object.userData.physicsBody && state.world) {
            state.world.removeBody(object.userData.physicsBody);
        }
        
        // 从场景中移除
        state.scene.remove(object);
        removedCount++;
    }
    
    // 清理物理世界中的所有静态体和敌人（除了地面和玩家）
    if (state.world && state.world.bodies) {
        const bodiesToRemove = [];
        for (let i = 0; i < state.world.bodies.length; i++) {
            const body = state.world.bodies[i];
            // 保留地面物理体和玩家物理体，清理其他所有物理体（包括敌人）
            if (body !== state.playerBody && 
                !(body.shapes.length > 0 && body.shapes[0] instanceof CANNON.Box && 
                  body.shapes[0].halfExtents && 
                  Math.abs(body.shapes[0].halfExtents.y - 0.05) < 0.01)) {
                bodiesToRemove.push(body);
            }
        }
        bodiesToRemove.forEach(body => state.world.removeBody(body));
        console.log(`✅ 清理了 ${bodiesToRemove.length} 个物理体（包括敌人）`);
    }
    
    // 重置状态数组
    state.spawnPoints = [];
    state.enemies = [];
    
    console.log(`✅ 总共清理了 ${removedCount} 个场景对象`);
    console.log('🧹 世界清理完成！');
}
