import * as THREE from 'three';

export function createTexture(color, type = 'noise') {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0,0,512,512);
    
    if(type === 'noise') {
        for(let i=0; i<60000; i++) {
            ctx.fillStyle = Math.random()>0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
            ctx.fillRect(Math.random()*512, Math.random()*512, 2, 2);
        }
    } else if (type === 'building') {
        ctx.fillStyle = '#1a1a1a';
        for(let y=20; y<512; y+=50) {
            for(let x=20; x<512; x+=50) {
                if(Math.random()>0.3) {
                    ctx.fillStyle = Math.random()>0.8 ? '#ffeb3b' : '#0a0a0a'; 
                    ctx.fillRect(x, y, 25, 35);
                }
            }
        }
    } else if (type === 'wood') {
        ctx.fillStyle = '#5d4037'; ctx.fillRect(0,0,512,512);
        ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 3;
        ctx.beginPath();
        for(let i=0;i<20;i++) {
                ctx.moveTo(0, Math.random()*512); ctx.lineTo(512, Math.random()*512);
        }
        ctx.stroke();
        ctx.strokeStyle = '#4e342e'; ctx.strokeRect(0,0,512,512);
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(512,512); ctx.moveTo(512,0); ctx.lineTo(0,512); ctx.stroke();
    } else if (type === 'metal') {
        ctx.fillStyle = '#455a64'; ctx.fillRect(0,0,512,512);
        ctx.fillStyle = '#37474f'; ctx.fillRect(10,10,492,492);
        ctx.strokeStyle = '#263238'; ctx.lineWidth=5;
        ctx.strokeRect(20,20,472,472);
    } else if (type === 'asphalt') {
        ctx.fillStyle = '#2b2b2b'; ctx.fillRect(0,0,512,512);
        for(let i=0; i<50000; i++) {
            ctx.fillStyle = Math.random()>0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
            ctx.fillRect(Math.random()*512, Math.random()*512, 1, 1);
        }
        ctx.strokeStyle = '#1f1f1f'; ctx.lineWidth = 6;
        ctx.strokeRect(0,0,512,512);
        // 道路标线改为白色
        ctx.fillStyle = '#ffffff';
        for(let y=0; y<512; y+=80) {
            ctx.fillRect(248, y, 16, 40);
        }
    } else if (type === 'grass') {
        ctx.fillStyle = '#2e7d32'; ctx.fillRect(0,0,512,512);
        for(let i=0; i<20000; i++) {
            ctx.fillStyle = Math.random()>0.5 ? 'rgba(46,125,50,0.3)' : 'rgba(56,142,60,0.3)';
            const w = Math.random()*4;
            const h = 8 + Math.random()*12;
            ctx.fillRect(Math.random()*512, Math.random()*512, w, h);
        }
    } else if (type === 'sidewalk') {
        ctx.fillStyle = '#bdbdbd'; ctx.fillRect(0,0,512,512);
        ctx.strokeStyle = '#9e9e9e'; ctx.lineWidth = 3;
        for(let i=0; i<=512; i+=64) {
            ctx.beginPath();
            ctx.moveTo(i,0); ctx.lineTo(i,512);
            ctx.moveTo(0,i); ctx.lineTo(512,i);
            ctx.stroke();
        }
    } else if (type === 'residential') {
        ctx.fillStyle = '#8d6e63'; ctx.fillRect(0,0,512,512);
        // 添加砖块纹理
        ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 2;
        for(let y=0; y<512; y+=20) {
            for(let x=0; x<512; x+=40) {
                ctx.strokeRect(x, y, 40, 20);
                if(Math.random() > 0.7) {
                    ctx.fillStyle = '#a1887f';
                    ctx.fillRect(x+5, y+5, 10, 10);
                    ctx.fillStyle = '#8d6e63';
                }
            }
        }
    } else if (type === 'commercial') {
        ctx.fillStyle = '#546e7a'; ctx.fillRect(0,0,512,512);
        // 添加现代建筑纹理
        ctx.strokeStyle = '#455a64'; ctx.lineWidth = 3;
        for(let y=0; y<512; y+=60) {
            for(let x=0; x<512; x+=60) {
                ctx.strokeRect(x, y, 60, 60);
                if(Math.random() > 0.5) {
                    ctx.fillStyle = '#607d8b';
                    ctx.fillRect(x+10, y+10, 40, 40);
                    ctx.fillStyle = '#546e7a';
                }
            }
        }
    } else if (type === 'industrial') {
        ctx.fillStyle = '#37474f'; ctx.fillRect(0,0,512,512);
        // 添加工业纹理
        ctx.strokeStyle = '#263238'; ctx.lineWidth = 4;
        for(let y=0; y<512; y+=80) {
            for(let x=0; x<512; x+=100) {
                ctx.strokeRect(x, y, 100, 80);
                // 添加波纹板效果
                for(let i=0; i<5; i++) {
                    ctx.beginPath();
                    ctx.moveTo(x, y + i*16);
                    ctx.lineTo(x+100, y + i*16);
                    ctx.stroke();
                }
            }
        }
    } else if (type === 'modernGlass') {
        // 现代玻璃幕墙 - 蓝绿色调，规律窗格
        ctx.fillStyle = '#1a5490'; ctx.fillRect(0,0,512,512);
        // 玻璃窗格
        ctx.strokeStyle = '#0d3d66'; ctx.lineWidth = 1;
        for(let y=0; y<512; y+=60) {
            for(let x=0; x<512; x+=40) {
                ctx.strokeRect(x, y, 40, 60);
                // 少量反光窗户
                if(Math.random() > 0.85) {
                    ctx.fillStyle = 'rgba(135,206,235,0.3)';
                    ctx.fillRect(x+2, y+2, 36, 56);
                    ctx.fillStyle = '#1a5490';
                }
            }
        }
        // 少量污渍
        for(let i=0; i<50; i++) {
            ctx.fillStyle = 'rgba(0,0,0,0.1)';
            ctx.fillRect(Math.random()*512, Math.random()*512, 5, 8);
        }
    } else if (type === 'concrete') {
        // 灰白混凝土 - 减少噪点，增加规律性
        ctx.fillStyle = '#d4d4d8'; ctx.fillRect(0,0,512,512);
        // 混凝土板缝
        ctx.strokeStyle = '#a1a1aa'; ctx.lineWidth = 1;
        for(let y=0; y<512; y+=100) {
            for(let x=0; x<512; x+=80) {
                ctx.strokeRect(x, y, 80, 100);
            }
        }
        // 少量色差和污渍
        for(let i=0; i<30; i++) {
            ctx.fillStyle = 'rgba(113,113,122,0.2)';
            ctx.fillRect(Math.random()*512, Math.random()*512, 20, 15);
        }
    } else if (type === 'warmConcrete') {
        // 暖灰混凝土
        ctx.fillStyle = '#c7c7cd'; ctx.fillRect(0,0,512,512);
        // 板块分割
        ctx.strokeStyle = '#a8a8b0'; ctx.lineWidth = 1;
        for(let y=0; y<512; y+=120) {
            for(let x=0; x<512; x+=90) {
                ctx.strokeRect(x, y, 90, 120);
            }
        }
        // 暖色调变化
        for(let i=0; i<25; i++) {
            ctx.fillStyle = 'rgba(205,192,176,0.15)';
            ctx.fillRect(Math.random()*512, Math.random()*512, 25, 20);
        }
    } else if (type === 'redBrick') {
        // 红砖纹理
        ctx.fillStyle = '#b45309'; ctx.fillRect(0,0,512,512);
        // 砖缝
        ctx.strokeStyle = '#92400e'; ctx.lineWidth = 1;
        for(let y=0; y<512; y+=15) {
            for(let x=0; x<512; x+=30) {
                ctx.strokeRect(x, y, 30, 15);
                // 砖块色差
                if(Math.random() > 0.7) {
                    ctx.fillStyle = '#dc2626';
                    ctx.fillRect(x+2, y+2, 26, 11);
                    ctx.fillStyle = '#b45309';
                }
            }
        }
    } else if (type === 'grayBrick') {
        // 灰砖纹理
        ctx.fillStyle = '#6b7280'; ctx.fillRect(0,0,512,512);
        // 砖缝
        ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 1;
        for(let y=0; y<512; y+=18) {
            for(let x=0; x<512; x+=36) {
                ctx.strokeRect(x, y, 36, 18);
                // 色差
                if(Math.random() > 0.6) {
                    ctx.fillStyle = '#9ca3af';
                    ctx.fillRect(x+3, y+3, 30, 12);
                    ctx.fillStyle = '#6b7280';
                }
            }
        }
    } else if (type === 'storefront') {
        // 店面玻璃 - 大面积玻璃+少量框架
        ctx.fillStyle = '#e5e7eb'; ctx.fillRect(0,0,512,512);
        // 玻璃区域
        ctx.fillStyle = '#1e293b'; 
        for(let y=0; y<512; y+=80) {
            for(let x=0; x<512; x+=60) {
                ctx.fillRect(x+5, y+10, 50, 60);
            }
        }
        // 框架
        ctx.strokeStyle = '#374151'; ctx.lineWidth = 3;
        for(let y=0; y<512; y+=80) {
            for(let x=0; x<512; x+=60) {
                ctx.strokeRect(x+5, y+10, 50, 60);
            }
        }
    } else if (type === 'metalRoof') {
        // 金属屋顶 - 波纹板
        ctx.fillStyle = '#64748b'; ctx.fillRect(0,0,512,512);
        // 波纹效果
        ctx.strokeStyle = '#475569'; ctx.lineWidth = 2;
        for(let y=0; y<512; y+=20) {
            for(let x=0; x<512; x+=40) {
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.quadraticCurveTo(x+20, y-5, x+40, y);
                ctx.stroke();
            }
        }
        // 锈迹
        for(let i=0; i<20; i++) {
            ctx.fillStyle = 'rgba(183,65,14,0.3)';
            ctx.fillRect(Math.random()*512, Math.random()*512, 15, 8);
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

