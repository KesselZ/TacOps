import * as THREE from 'three';
import { state } from './globals.js';
import { CONFIG } from './config.js';
import { reload, buildWeapon } from './weapon.js';
import { startGame, endGame } from './main.js'; // Circular dep
import { showPauseMenu } from './ui.js';
import { startHealing, startArmorRepair, cancelHealing, cancelArmorRepair } from './medical.js';
import { toggleBackpack, isBackpackVisible } from './backpackUI.js';
import { collisionGrid } from './collisionGrid.js';
import { spawnDebris, handleUseKey } from './world.js';
import { playSlideSound, stopSlideSound, updateSlideSoundPosition } from './audio.js';

// 基于碰撞法线的着地判定
function checkGroundedByNormal() {
    if (!state.playerBody || !state.raycaster) return { isGrounded: false };
    
    // 联机 Arena 模式使用简化的平面地面判定（y=0 附近）
    // Arena 地图目前只有一个 Cannon 平面地板，没有静态 Mesh 写入 collisionGrid，
    // 射线基于静态 Mesh 的检测在这里拿不到命中，导致始终判定为空中。
    // 为了保证玩法一致性，这里在 mp_arena 下优先用高度 + 竖直速度判定着地。
    if (state.gameMode === 'mp_arena') {
        const playerPos = state.playerBody.position;
        const vy = state.playerBody.velocity.y;
        const distance = playerPos.y; // 距离 y=0 平面的大致高度

        // 距离地面不高、竖直速度接近 0 时认为落地
        if (distance >= 0 && distance <= 0.7 && Math.abs(vy) < 1.5) {
            return {
                isGrounded: true,
                normal: new THREE.Vector3(0, 1, 0),
                distance,
                object: null
            };
        }
    }

    const playerPos = state.playerBody.position;
    const rayStart = new THREE.Vector3(playerPos.x, playerPos.y + 0.2, playerPos.z);
    const rayDirection = new THREE.Vector3(0, -1, 0);
    
    state.raycaster.set(rayStart, rayDirection);
    
    // 检测Cannon的接触点
    let cannonContact = null;
    let cannonNormal = null;
    if (state.playerBody.contacts) {
        for (let i = 0; i < state.playerBody.contacts.length; i++) {
            const contact = state.playerBody.contacts[i];
            if (contact.bi === state.playerBody || contact.bi === contact.bj) {
                // 找到玩家相关的接触
                const contactPoint = contact.bi === state.playerBody ? contact.ri : contact.rj;
                cannonContact = contactPoint;
                cannonNormal = contact.n;
                break;
            }
        }
    }
    
    // 更新监控变量
    state.cannonContactPoint = cannonContact ? 
        `(${cannonContact.x.toFixed(2)}, ${cannonContact.y.toFixed(2)}, ${cannonContact.z.toFixed(2)})` : 
        '无接触';
    state.cannonContactNormal = cannonNormal ? 
        `(${cannonNormal.x.toFixed(2)}, ${cannonNormal.y.toFixed(2)}, ${cannonNormal.z.toFixed(2)})` : 
        '无法线';
    
    // 添加射线起点监控
    state.rayStartPoint = `(${rayStart.x.toFixed(2)}, ${rayStart.y.toFixed(2)}, ${rayStart.z.toFixed(2)})`;
    
    // 使用碰撞网格：仅获取玩家附近一定半径内的静态物体
    const radius = 20; // 20米半径足够覆盖脚下地面和周边道路
    let nearbyStatics = [];
    if (collisionGrid && typeof collisionGrid.getNearbyStaticObjects === 'function') {
        nearbyStatics = collisionGrid.getNearbyStaticObjects(playerPos.x, playerPos.z, radius) || [];
    }

    // 直接使用所有静态物体进行射线检测，不再进行材质过滤
    const intersects = state.raycaster.intersectObjects(nearbyStatics);
    
    if (intersects.length > 0) {
        const hit = intersects[0];
        const distance = hit.distance;
        const normal = hit.face.normal;
        
        // 更新全局监控变量
        state.groundDistance = distance;
        const objectInfo = hit.object.userData ? 
            `Group(${hit.object.userData.isStatic ? '静态' : '动态'})` : 
            `Mesh(${hit.object.type || 'unknown'})`;
        state.groundObject = objectInfo;
        // 记录真实的脚下命中对象和法线，供滑铲起沙等效果使用
        state.groundHitObject = hit.object;
        state.groundHitNormal = normal.clone();
        
        // 添加法线Y分量监控
        state.groundNormalY = normal.y;
        
        // 检查距离是否在合理范围内：
        //  - 大于等于 0：不再忽略极小距离
        //  - 小于等于 0.7m：只把脚下 0.7 米内的表面当作"地面"
        if (distance >= 0 && distance <= 0.7) {
            // 检查法线是否向上（Y分量 > 0.5 表示接近垂直向上）
            // 陡坡直接判定为空中，禁止移动
            if (normal.y > 0.5) {
                return {
                    isGrounded: true,
                    normal: normal,
                    distance: distance,
                    object: hit.object
                };
            }
            // 法线Y <= 0.5的陡坡不返回任何值，默认为空中状态
        }
        
        // 如果检测到物体但距离超过0.7米，更新距离显示但不认为着地
        // 这样UI就能显示真实的射线检测距离
        if (intersects.length > 0 && distance > 0.7) {
            state.groundDistance = distance; // 保持实际距离
            state.groundObject = objectInfo + ' (过远)';
        }
    }
    
    // 只有在真正没有检测到任何物体时才重置为0
    if (intersects.length === 0) {
        state.groundDistance = 0;
        state.groundObject = '无';
        state.groundNormalY = 0; // 没有法线时设为0
        state.groundHitObject = null;
        state.groundHitNormal = null;
    }
    
    // 备用检测：如果射线检测失败，使用简单的Y值判定（更严格的条件）
    const vy = state.playerBody.velocity.y;
    const nearGround = playerPos.y <= 0.3 && vy <= 1.0 && Math.abs(vy) < 1.0;
    
    if (nearGround) {
        return {
            isGrounded: true,
            normal: new THREE.Vector3(0, 1, 0), // 默认向上法线
            distance: playerPos.y,
            object: null,
            isBackup: true
        };
    }
    
    return { isGrounded: false };
}

// 基于地面法线调整移动方向（用于斜坡移动）
function adjustMovementForSlope(moveDirection, groundNormal) {
    if (!groundNormal || groundNormal.y > 0.95) {
        // 平地或接近平地，不需要调整
        return moveDirection;
    }
    
    // 计算在斜坡上的投影移动方向
    const right = new THREE.Vector3(1, 0, 0);
    const forward = new THREE.Vector3(0, 0, 1);
    
    // 将移动方向投影到斜坡表面
    const slopeAdjusted = moveDirection.clone();
    
    // 如果是陡坡，降低移动速度
    const slopeFactor = groundNormal.y; // 0.7-1.0，越陡越小
    slopeAdjusted.multiplyScalar(slopeFactor);
    
    return slopeAdjusted;
}

export function initEvents() {
    function isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    const onKey = (e, down) => {
        // 检查输入是否被禁用（死亡状态）
        if (state.isInputDisabled) {
            return;
        }
        
        // Esc / 暂停逻辑只在按下时处理
        if (down && e.code === 'Escape') {
            if (state.isGameActive) {
                // 如果背包/容器界面打开，优先关闭它，而不是进入暂停
                if (isBackpackVisible()) {
                    // 与 Tab 行为保持一致：退出时清理容器上下文，阻断后续摸金/揭示流程
                    state.activeContainer = null;
                    toggleBackpack(false);
                    return;
                }

                if (state.isPaused) {
                    // 已暂停时，Esc 不做任何操作，只能通过点击 RESUME 恢复
                    return;
                } else {
                    // 游戏中按 Esc：退出指针锁，pointerlockchange 中进入暂停
                    if (document.pointerLockElement) {
                        document.exitPointerLock();
                    } else {
                        // 没有指针锁时直接弹出暂停菜单
                        state.isPaused = true;
                        state.pauseCooldownUntil = performance.now() + 1500; // 1.5秒冷却期
                        showPauseMenu(true);
                    }
                }
            }
            return;
        }

        // 暂停状态下：禁止移动，只响应 1/2/3 菜单热键（需要冷却期）
        if (state.isPaused) {
            if (down) {
                const now = performance.now();
                if (now < state.pauseCooldownUntil) {
                    // 还在冷却期，不响应按键
                    return;
                }
                
                // 暂停菜单中按 Tab：切换到背包界面
                if (e.code === 'Tab') {
                    e.preventDefault();
                    showPauseMenu(false);
                    state.isPaused = false;
                    toggleBackpack();
                    return;
                }

                if (e.code === 'Digit1') {
                    if (window.resumeGameFromPause) window.resumeGameFromPause();
                } else if (e.code === 'Digit2') {
                    // 预留：设置
                } else if (e.code === 'Digit3') {
                    if (window.exitToMenuFromPause) window.exitToMenuFromPause();
                }
            }
            return;
        }

        // 背包打开时：禁止处理移动和蹲下相关按键，让玩家原地不动
        const backpackOpen = isBackpackVisible();

        switch(e.code) {
            case 'Tab':
                if (down) {
                    e.preventDefault();
                    // 通过 Tab 打开背包时，清除上一次交互遗留的容器上下文，进入纯背包界面
                    state.activeContainer = null;
                    toggleBackpack();
                }
                break;
            case 'KeyB':
                if (down) {
                    // 通过 B 打开背包时，同样不保留容器上下文
                    state.activeContainer = null;
                    toggleBackpack();
                }
                break;
            case 'KeyW': if (!backpackOpen) state.moveInput.f = down ? 1 : 0; break;
            case 'KeyS': if (!backpackOpen) state.moveInput.b = down ? 1 : 0; break;
            case 'KeyA': if (!backpackOpen) state.moveInput.l = down ? 1 : 0; break;
            case 'KeyD': if (!backpackOpen) state.moveInput.r = down ? 1 : 0; break;
            case 'ShiftLeft': if (!backpackOpen) state.isSprinting = down; break;
            case 'Space':
                if (state.flyMode) {
                    state.flyInput.up = down ? 1 : 0;
                } else if (down) {
                    // 主动按空格跳跃时，如果正在滑铲，立刻结束滑铲而不是等待空中缓冲
                    if (state.isSliding) {
                        state.isSliding = false;
                        if (typeof state.slideAirTime === 'number') state.slideAirTime = 0;
                        stopSlideSound();
                        // 滑铲跳时清除蹲下状态，避免起跳后短暂被“蹲速”地面逻辑拉慢
                        state.isCrouching = false;
                        if (typeof state.crouchAmount === 'number') {
                            state.crouchAmount = 0;
                        }
                    }
                    tryJump();
                }
                break;
            case 'ControlLeft':
                if (state.flyMode) {
                    state.flyInput.down = down ? 1 : 0;
                } else if (!backpackOpen) {
                    state.isCrouching = down;
                }
                break;
            case 'KeyR': if(down) reload(); break;
            case 'KeyQ': state.leanState = down ? -1 : 0; break;
            case 'KeyE': state.leanState = down ? 1 : 0; break;
            case 'Digit4': 
                if(down) {
                    if(state.isHealing) cancelHealing();
                    else startHealing();
                }
                break;
            case 'Digit5':
                if(down) {
                    if(state.isRepairingArmor) cancelArmorRepair();
                    else startArmorRepair();
                }
                break;
            case 'KeyC':
                if (!state.flyMode && !backpackOpen) {
                    state.isCrouching = down;
                }
                break;
            case 'KeyF':
                if (down && !backpackOpen && state.isGameActive && !state.isPaused) {
                    handleUseKey();
                }
                break;
        }
    };
    document.addEventListener('keydown', e => onKey(e, true));
    document.addEventListener('keyup', e => onKey(e, false));
    
    // 阻断常见浏览器快捷键（只在游戏指针锁住时生效），避免滑铲组合键误触
    // 注意：只阻止浏览器默认行为，不阻断游戏内的按键逻辑（例如 Ctrl+W 滑铲、Ctrl 蹲下）
    document.addEventListener('keydown', (e) => {
        // 没有鼠标锁 / 在菜单里 / 在输入框里，都不拦截
        if (!state.controlsLocked || !document.pointerLockElement) return;
        if (isTypingTarget(e.target)) return;

        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const key = e.key.toLowerCase();
        const block =
            (ctrl && (key === 's' || key === 'd' || key === 'r' || key === 'p' || key === 'w' || 
                     key === 'a' || key === 'q' || key === 'e' || key === 'f' || key === 'g' || 
                     key === 'h' || key === 'j' || key === 'k' || key === 'l' || key === 'z' || 
                     key === 'x' || key === 'c' || key === 'v' || key === 'b' || key === 'n' || 
                     key === 'm' || key === 'u' || key === 'i' || key === 'o' || key === 't')) ||
            (shift && (e.key === 'F10' || e.key === 'F9' || e.altKey || e.ctrlKey)) ||
            e.key === 'F5' || e.key === 'F11' || e.key === 'F12' || e.key === 'Escape';
        if (block) {
            e.preventDefault(); // 仅阻止浏览器默认行为，让事件继续传播给游戏逻辑
        }
    }, true);

    // 指针锁住时禁右键菜单，避免误触浏览器菜单
    window.addEventListener('contextmenu', (e) => {
        if (state.controlsLocked && document.pointerLockElement) {
            e.preventDefault();
        }
    });
    document.addEventListener('mousedown', e => { 
        if (state.isInputDisabled) return;
        if(!state.controlsLocked) return; 
        if(e.button===0) state.isFiring=true; 
        if(e.button===2) state.isAiming=true; 
    });
    document.addEventListener('mouseup', e => { 
        if (state.isInputDisabled) return;
        if(e.button===0) state.isFiring=false; 
        if(e.button===2) state.isAiming=false; 
    });
    document.addEventListener('mousemove', e => {
        if(!state.controlsLocked) return;

        const maxDelta = 80;
        const moveX = Math.max(-maxDelta, Math.min(maxDelta, e.movementX));
        const moveY = Math.max(-maxDelta, Math.min(maxDelta, e.movementY));

        const sensitivityMultiplier = state.mouseSensitivity || 1.0;
        const sens = state.isAiming ? (CONFIG.adsSensitivity * sensitivityMultiplier) : (CONFIG.baseSensitivity * sensitivityMultiplier);
        state.cameraYaw -= moveX * sens;
        state.cameraPitch -= moveY * sens;

        // 限制俯仰角，与 updatePlayer 中保持一致
        state.cameraPitch = Math.max(-1.5, Math.min(1.5, state.cameraPitch));

        // 供武器摇摆等效果使用
        state.lastLookDelta.set(moveX, moveY);
    });
    document.addEventListener('pointerlockchange', () => {
        state.controlsLocked = !!document.pointerLockElement;
        if (state.controlsLocked) {
            if (navigator.keyboard && navigator.keyboard.lock) {
                navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft']).catch(() => {});
            }
        } else {
            state.mouseDelta.set(0, 0);
            state.lastLookDelta.set(0, 0);
            if (navigator.keyboard && navigator.keyboard.unlock) {
                navigator.keyboard.unlock();
            }
            // 在游戏进行中丢失指针锁（例如按下 Esc），进入暂停而不是直接结束游戏
            // 但如果此时背包界面可见，则认为是打开背包，不触发暂停
            if(state.isGameActive && !state.isPaused && !isBackpackVisible()) {
                state.isPaused = true;
                state.pauseCooldownUntil = performance.now() + 1500; // 1.5秒冷却期
                showPauseMenu(true);
            }
        }
    });
    
    window.addEventListener('resize', () => {
        if(!state.camera || !state.renderer) return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        state.camera.aspect = width / height; 
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(width, height);

        if (state.weaponCamera) {
            state.weaponCamera.aspect = width / height;
            state.weaponCamera.updateProjectionMatrix();
        }

        if (state.composer) {
            state.composer.setSize(width, height);
        }

        if (state.ssaoPass) {
            state.ssaoPass.setSize(width, height);
        }

        if (state.smaaPass) {
            state.smaaPass.setSize(width * state.renderer.getPixelRatio(), height * state.renderer.getPixelRatio());
        }
    });
}

function tryJump() { 
    const now = performance.now();
    const jumpCooldownMs = 200;
    const cooledDown = now - state.lastJumpTime >= jumpCooldownMs;

    // 仅在当前确实落地且冷却结束时允许起跳，避免空中二段跳
    if (state.isGrounded && cooledDown) {
        state.playerBody.velocity.y = CONFIG.jumpForce;
        state.isGrounded = false;
        state.lastJumpTime = now;
    }
}

export function updatePlayer(dt) {
    if(!state.playerBody) return false;
    
    // 防掉落检查：如果玩家掉出地图，重置到安全位置
    if (state.playerBody.position.y < -50) {
        console.warn(`⚠️ 玩家掉出地图！位置: (${state.playerBody.position.x.toFixed(1)}, ${state.playerBody.position.y.toFixed(1)}, ${state.playerBody.position.z.toFixed(1)})`);
        state.playerBody.position.set(0, 10, 0);
        state.playerBody.velocity.set(0, 0, 0);
    }
    
    // 使用基于法线的着地判定（飞行模式下跳过）
    if (!state.flyMode) {
        const groundCheck = checkGroundedByNormal();
        const wasGrounded = state.isGrounded;
        
        if (groundCheck.isGrounded) {
            state.isGrounded = true;
            state.lastGroundedTime = performance.now();
            // 着地时重置滑铲空中计时器
            if (typeof state.slideAirTime !== 'number') state.slideAirTime = 0;
            state.slideAirTime = 0;
            
            // 检测空中→地面的转换，触发落地震动（带竖直速度阈值）
            if (!state.wasGrounded) {
                const vy = state.playerBody.velocity.y;
                const impactSpeed = Math.abs(vy);
                const impactThreshold = 3.0; // 只有当落地竖直速度绝对值大于该阈值时才震动
                if (impactSpeed > impactThreshold) {
                    state.landingShockIntensity = 0.5; // 增加震动强度
                    state.landingShockTime = 0; // 重置震动时间
                }
            }
            state.wasGrounded = true;
            
            // 存储当前着地法线，可用于后续的斜坡移动等
            state.groundNormal = groundCheck.normal;
            state.groundDistance = groundCheck.distance;
        } else {
            state.isGrounded = false;
            state.wasGrounded = false; // 标记离开地面
            state.groundNormal = null;
            // 不要重置 groundDistance，让它保持射线检测的实际距离
            // state.groundDistance = null; // 注释掉这行
        }
    } else {
        // 飞行模式下视作空中状态
        state.isGrounded = false;
        state.wasGrounded = false;
        state.groundNormal = null;
    }

    // 处理视角旋转
    state.cameraPitch = Math.max(-1.5, Math.min(1.5, state.cameraPitch));
    state.camera.rotation.x = state.cameraPitch;
    state.camera.rotation.y = state.cameraYaw;

    // 🆕 蹲下平滑插值：在 0~1 之间平滑过渡，避免瞬间切换
    if (typeof state.crouchAmount !== 'number') state.crouchAmount = 0;
    // 滑铲时插值目标略大于 1，让速度和姿态更快更低
    const crouchTarget = (state.isCrouching && !state.flyMode) ? (state.isSliding ? 1.2 : 1) : 0;
    const crouchLerpSpeed = 15; // 越大切换越快
    const crouchAlpha = Math.min(1, dt * crouchLerpSpeed);
    state.crouchAmount = THREE.MathUtils.lerp(state.crouchAmount, crouchTarget, crouchAlpha);

    let speed = state.isAiming ? CONFIG.adsSpeed : (state.isSprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed);

    if (!state.flyMode && state.crouchAmount > 0.001) {
        const crouchSpeedMul = 0.45;
        const baseMul = 1.0;
        const currentMul = baseMul + (crouchSpeedMul - baseMul) * state.crouchAmount;
        speed *= currentMul;
    }
    
    // 使用医疗时移动速度降低70%
    if (state.isHealing || state.isRepairingArmor) {
        speed *= 0.3;
    }
    
    const yaw = state.cameraYaw;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    const moveDir = new THREE.Vector3();
    if(state.moveInput.f) moveDir.add(forward); if(state.moveInput.b) moveDir.sub(forward);
    if(state.moveInput.r) moveDir.add(right); if(state.moveInput.l) moveDir.sub(right);
    if(moveDir.lengthSq() > 0) moveDir.normalize();

    // 🆕 滑铲触发检测：奔跑中 + 在地面 + 有移动输入 时按下蹲键
    if (typeof state.isSliding !== 'boolean') state.isSliding = false;
    if (typeof state.slideTime !== 'number') state.slideTime = 0;
    if (!state.slideDir) state.slideDir = new THREE.Vector3();
    if (typeof state.slideCooldownUntil !== 'number') state.slideCooldownUntil = 0;
    if (typeof state.slideAirTime !== 'number') state.slideAirTime = 0; // 空中缓冲计时器
    const crouchPressed = !!(state.isCrouching && !state.flyMode);
    const wasCrouchPressed = !!state.prevCrouchPressed;
    const justCrouchPressed = crouchPressed && !wasCrouchPressed;
    state.prevCrouchPressed = crouchPressed;

    const now = performance.now();
    const canSlide = now > state.slideCooldownUntil;
    if (justCrouchPressed && state.isGrounded && state.isSprinting && moveDir.lengthSq() > 0.0001 && canSlide) {
        state.isSliding = true;
        state.slideTime = 0;
        state.slideDir.copy(moveDir);
        // 滑铲开始音效：只在新一次滑铲触发时播放，位置在玩家身体附近
        playSlideSound(state.playerBody && state.playerBody.position);
    }

    // 更新击退禁用时间
    if (state.knockbackDisableTime > 0) {
        state.knockbackDisableTime -= dt;
        if (state.knockbackDisableTime < 0) state.knockbackDisableTime = 0;
    }

    // 飞行模式：忽略地面，仅使用 WASD + 空格/左Ctrl 三维移动
    if (state.flyMode) {
        const flySpeed = speed * 1.2;
        const vel = state.playerBody.velocity;

        // 水平移动
        if (moveDir.lengthSq() > 0.0001) {
            vel.x = moveDir.x * flySpeed;
            vel.z = moveDir.z * flySpeed;
            state.wasMoving = true;
        } else {
            vel.x = 0;
            vel.z = 0;
            state.wasMoving = false;
        }

        // 垂直移动（Space 上升，左 Ctrl 下降）
        let vertical = 0;
        if (state.flyInput && state.flyInput.up) vertical += 1;
        if (state.flyInput && state.flyInput.down) vertical -= 1;
        if (vertical !== 0) {
            vel.y = vertical * flySpeed;
        } else {
            vel.y = 0;
        }

        // 不在这里 return，留到函数末尾统一做相机更新和返回值
    }

    if(state.isGrounded) {
        // 地面：应用斜坡调整后的移动
        let adjustedMoveDir = moveDir;
        if (state.groundNormal) {
            adjustedMoveDir = adjustMovementForSlope(moveDir, state.groundNormal);
        }

        // 🆕 滑铲物理：在滑铲期间，用沿初始方向的滑行速度替代普通WASD移动
        if (state.isSliding) {
            state.slideTime += dt;

            // 基础起始速度略高于冲刺速度
            const slideStartSpeed = CONFIG.sprintSpeed * 1.7;
            const slideFriction = 9.0; // 越大减速越快
            const t = state.slideTime;
            const slideSpeed = Math.max(0, slideStartSpeed - slideFriction * t);

            const minSlideSpeed = CONFIG.walkSpeed * 0.9;
            const stillCrouching = !!(state.isCrouching && !state.flyMode);

            if (!stillCrouching || slideSpeed <= minSlideSpeed || t > 1.2) {
                // 条件不满足：结束滑铲，回到普通移动逻辑（不再有任何惩罚）
                state.isSliding = false;
                stopSlideSound();
                state.slideAirTime = 0;
            } else {
                // 应用滑铲速度（保持水平方向，不改Y速度）
                state.playerBody.velocity.x = state.slideDir.x * slideSpeed;
                state.playerBody.velocity.z = state.slideDir.z * slideSpeed;
                state.wasMoving = true;
                // 更新滑铲音效位置，让声音跟随玩家身体
                if (state.playerBody) {
                    updateSlideSoundPosition(state.playerBody.position);
                }
                // 滑铲起沙：仅在贴地滑铲时，按时间间隔沿路径生成地面碎屑
                const nowMs = performance.now();
                if (typeof state.lastSlideDebrisTime !== 'number') state.lastSlideDebrisTime = 0;
                const DEBRIS_INTERVAL_MS = 70; // 每约70ms生成一批
                if (state.isGrounded && nowMs - state.lastSlideDebrisTime >= DEBRIS_INTERVAL_MS) {
                    state.lastSlideDebrisTime = nowMs;

                    // 碎屑位置：玩家脚下稍微抬高、并往前推，让视野中能清楚看到沙砾
                    const forward2D = new THREE.Vector3(state.slideDir.x, 0, state.slideDir.z).normalize();
                    const footPos = new THREE.Vector3(
                        state.playerBody.position.x,
                        state.playerBody.position.y - 0.25,
                        state.playerBody.position.z
                    );
                    footPos.add(forward2D.multiplyScalar(0.8)); // 向前推 ~0.8 米

                    // 使用真实地面法线（如果有），否则默认向上；并稍微加强向上分量，让沙砾飞得更高
                    const baseNormal = (state.groundHitNormal && state.groundHitNormal.clone()) || new THREE.Vector3(0, 1, 0);
                    const groundNormal = baseNormal.clone();
                    groundNormal.y = Math.min(1.0, groundNormal.y + 0.6); // 往上抬头
                    groundNormal.normalize();

                    // 使用当前脚下地面的debrisColor，没有就用深灰色当作沙砾/柏油
                    let debrisColor = 0x2a2a2a;
                    const groundObj = state.groundHitObject;
                    if (groundObj && groundObj.userData && groundObj.userData.debrisColor) {
                        debrisColor = groundObj.userData.debrisColor;
                    }

                    // 数量略增、尺寸保持：更明显的滑铲摩擦沙砾
                    spawnDebris(footPos, groundNormal, debrisColor, 6, 0.7);
                }

                // 跳过普通地面移动与减速逻辑
                // 防止下面逻辑覆盖，直接进入后续视角/相机更新
            }
        }

        if (!state.isSliding) {
            // 击退期间禁用WASD移动
            if (state.knockbackDisableTime > 0) {
                // 击退期间：不处理WASD输入，让击退效果完整体现
                // 击退速度会被手动减速系统自然消耗
            } else if(moveDir.lengthSq() > 0.0001) {
                // 正常情况：有移动输入，设置目标速度
                state.playerBody.velocity.x = adjustedMoveDir.x * speed;
                state.playerBody.velocity.z = adjustedMoveDir.z * speed;
                state.wasMoving = true;
            } else {
                // 无移动输入：对总速度手动减速（包含击退速度），不再重复累加击退
                const currentHVel = new THREE.Vector2(state.playerBody.velocity.x, state.playerBody.velocity.z);
                const decelerationRate = 45.0; // 减速率（米/秒²）
                const decelAmount = decelerationRate * dt;
                
                if (currentHVel.length() > decelAmount) {
                    // 减速：直接在总速度上减，不加击退
                    const newVel = currentHVel.clone().normalize().multiplyScalar(currentHVel.length() - decelAmount);
                    state.playerBody.velocity.x = newVel.x;
                    state.playerBody.velocity.z = newVel.y;
                } else {
                    // 速度很低，直接归零
                    state.playerBody.velocity.x = 0;
                    state.playerBody.velocity.z = 0;
                }
                state.wasMoving = false;
            }
        }
    } else {
        // 空中：允许短暂的滑铲缓冲时间，避免从小坡或台阶滑下立刻中断
        if (state.isSliding) {
            if (typeof state.slideAirTime !== 'number') state.slideAirTime = 0;
            state.slideAirTime += dt;
            const maxAirSlideTime = 0.2; // 最多在空中继续滑铲 0.2 秒
            if (state.slideAirTime > maxAirSlideTime) {
                state.isSliding = false;
                stopSlideSound();
            }
        }

        // 空中：允许一定比例的 WASD 控制，同时保留惯性与速度上限
        const maxAirSpeed = CONFIG.sprintSpeed * 1.05; // 稍高于冲刺跑速，保证“奔跑跳”不会比跑慢

        // 空中控制强度：1.0 表示与地面相同的控制力
        const airControl = 1.0;
        if (moveDir.lengthSq() > 0.0001) {
            // 施加一个与地面速度成比例、但强度较小的水平加速度
            state.playerBody.velocity.x += moveDir.x * speed * airControl * dt;
            state.playerBody.velocity.z += moveDir.z * speed * airControl * dt;
        }

        // 保持原有的空中速度上限钳制，避免空中无限加速
        const hVel = new THREE.Vector2(state.playerBody.velocity.x, state.playerBody.velocity.z);
        if (hVel.length() > maxAirSpeed) {
            hVel.normalize();
            hVel.multiplyScalar(maxAirSpeed);
            state.playerBody.velocity.x = hVel.x;
            state.playerBody.velocity.z = hVel.y;
        }
    }

    state.currentLeanFactor = THREE.MathUtils.lerp(state.currentLeanFactor, state.leanState, dt * 10);
    const leanOffset = new THREE.Vector3(state.currentLeanFactor * CONFIG.leanDistance, 0, 0);
    leanOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); 

    // View bobbing / 移动判定
    const isMoving = state.flyMode
        ? (moveDir.lengthSq() > 0.0001 || (state.flyInput && (state.flyInput.up || state.flyInput.down)))
        : (moveDir.lengthSq() > 0.0001 && state.isGrounded);
    // 奔跑幅度恢复为原始的 0.08，走路保留略微增强的 0.07
    const targetBobIntensity = isMoving ? (state.isSprinting ? 0.08 : 0.07) : 0;
    state.viewBobIntensity = THREE.MathUtils.lerp(state.viewBobIntensity, targetBobIntensity, dt * 6);
    // 奔跑频率提升，节奏更紧：走路 9，奔跑从 14 → 16
    const bobSpeed = state.isSprinting ? 16 : 9;
    if(isMoving) {
        state.viewBobPhase += dt * bobSpeed;
    } else {
        // 静止时完全停止view bob相位变化，避免影响射击精度
        // state.viewBobPhase 保持不变
    }
    
    // 落地震动效果（瞬间冲击，不是长时间摇晃）
    if (!state.landingShockIntensity) state.landingShockIntensity = 0;
    if (!state.landingShockTime) state.landingShockTime = 0;
    
    let landingBobY = 0;
    if (state.landingShockIntensity > 0.001) {
        // 利索震动：0.15秒内完成
        state.landingShockTime += dt;
        const shockProgress = Math.min(state.landingShockTime / 0.15, 1.0);
        
        // 利索硬朗震动：轻微下沉→快速回弹
        if (shockProgress < 0.3) {
            // 前30%时间：轻微下沉（减少一半）
            landingBobY = -state.landingShockIntensity * 0.3 * (shockProgress / 0.3);
        } else {
            // 后70%时间：快速回弹到原位
            const reboundProgress = (shockProgress - 0.3) / 0.7;
            landingBobY = -state.landingShockIntensity * 0.3 * (1 - reboundProgress);
        }
        
        // 震动完成
        if (shockProgress >= 1.0) {
            state.landingShockIntensity = 0;
            state.landingShockTime = 0;
            landingBobY = 0;
        }
    }
    
    // 添加轻微的X轴震动增强效果
    const landingBobX = state.landingShockIntensity > 0.001 ? 
        (Math.random() - 0.5) * state.landingShockIntensity * 0.1 : 0;
    
    const bobOffsetY = Math.sin(state.viewBobPhase) * state.viewBobIntensity + landingBobY;
    const bobOffsetX = Math.cos(state.viewBobPhase * 0.5) * state.viewBobIntensity * 0.5 + landingBobX;

    state.camera.position.copy(state.playerBody.position);
    const standHeight = 0.6;
    const crouchHeight = 0.4;
    // 滑铲时相机高度再低一点，更贴近地面
    const slideHeight = 0.25;
    const camHeight = standHeight + (crouchHeight - standHeight) * (state.crouchAmount || 0);
    const finalHeight = state.isSliding ? slideHeight : camHeight;
    state.camera.position.y += finalHeight; 
    state.camera.position.add(leanOffset);
    
    // 应用震动偏移到相机位置
    const bobWorldOffset = new THREE.Vector3(bobOffsetX, bobOffsetY, 0);
    bobWorldOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); // 让X偏移跟随朝向
    state.camera.position.add(bobWorldOffset);
    
    state.camera.rotation.z = -state.currentLeanFactor * 0.3; 
    
    // Is moving?
    return moveDir.lengthSq() > 0;
}
