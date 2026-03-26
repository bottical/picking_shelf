// Mobile Wall Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const wallHeader = document.getElementById('wallHeader');
        const wallTitle = document.getElementById('wallTitle');
        const backBtn = document.getElementById('backBtn');
        const openSettingsBtn = document.getElementById('openSettingsBtn');
        const homeBtn = document.getElementById('homeBtn');
        
        const multiViewContainer = document.getElementById('multiViewContainer');
        const selectorViewContainer = document.getElementById('selectorViewContainer');
        const singleViewContainer = document.getElementById('singleViewContainer');
        const bay10Container = document.getElementById('bay10-container');
        
        const setupOverlay = document.getElementById('setupOverlay');
        const settingBays = document.getElementById('settingBays');
        const settingViewMode = document.getElementById('settingViewMode');
        const singleSettings = document.getElementById('singleSettings');
        const settingOrientation = document.getElementById('settingOrientation');
        const multiSettings = document.getElementById('multiSettings');
        const settingMultiRows = document.getElementById('settingMultiRows');
        const settingMultiCols = document.getElementById('settingMultiCols');
        const settingMultiStartId = document.getElementById('settingMultiStartId');
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');

        // Bay Edit Elements
        const bayEditOverlay = document.getElementById('bayEditOverlay');
        const editBayTitle = document.getElementById('editBayTitle');
        const bayAddSplitBtn = document.getElementById('bayAddSplitBtn');
        const bayRemoveSplitBtn = document.getElementById('bayRemoveSplitBtn');
        const bayResetBtn = document.getElementById('bayResetBtn');
        const bayEditCancelBtn = document.getElementById('bayEditCancelBtn');
        let editTargetBay = null;

        let currentSingleBayId = null; // null means show selector

        const stateMgr = new StateManager(
            (state) => render(state),
            (user) => {
                if (!user) window.location.href = 'index.html';
            }
        );

        // --- Setup Logic ---
        settingViewMode.addEventListener('change', () => {
            if (settingViewMode.value === 'single') {
                singleSettings.classList.remove('hidden');
                multiSettings.classList.add('hidden');
            } else {
                singleSettings.classList.add('hidden');
                multiSettings.classList.remove('hidden');
            }
        });

        const showSetup = (canCancel) => {
            setupOverlay.classList.remove('hidden');
            if (canCancel) {
                closeSettingsBtn.classList.remove('hidden');
            } else {
                closeSettingsBtn.classList.add('hidden');
            }
            // Populate current values
            const cfg = stateMgr.state?.config || {};
            if (cfg.bays) settingBays.value = cfg.bays;
            if (cfg.viewMode) settingViewMode.value = cfg.viewMode;
            if (cfg.orientation) settingOrientation.value = cfg.orientation;
            if (cfg.multiRows) settingMultiRows.value = cfg.multiRows;
            if (cfg.multiCols) settingMultiCols.value = cfg.multiCols;
            if (cfg.multiStartId) settingMultiStartId.value = cfg.multiStartId;
            settingViewMode.dispatchEvent(new Event('change'));
        };

        const hideSetup = () => setupOverlay.classList.add('hidden');

        openSettingsBtn.addEventListener('click', () => showSetup(true));
        closeSettingsBtn.addEventListener('click', () => hideSetup());

        saveSettingsBtn.addEventListener('click', () => {
            const newConfig = {
                bays: parseInt(settingBays.value) || 9,
                viewMode: settingViewMode.value,
                orientation: settingOrientation.value,
                multiRows: parseInt(settingMultiRows.value) || 3,
                multiCols: parseInt(settingMultiCols.value) || 3,
                multiStartId: parseInt(settingMultiStartId.value) || 1,
                maxSplit: 6
            };
            stateMgr.update({ config: newConfig });
            hideSetup();
            currentSingleBayId = null; // reset to selector if in single mode
            render(stateMgr.state);
        });

        // --- Edit Bay Logic ---
        bayEditCancelBtn.onclick = () => bayEditOverlay.classList.add('hidden');
        
        bayAddSplitBtn.onclick = () => {
            if (!editTargetBay) return;
            const splitCount = stateMgr.state.splits?.[editTargetBay] || 1;
            const maxSplit = 6;
            if (splitCount < maxSplit) {
                stateMgr.update({ [`splits.${editTargetBay}`]: splitCount + 1 });
            }
            bayEditOverlay.classList.add('hidden');
        };

        bayRemoveSplitBtn.onclick = () => {
            if (!editTargetBay) return;
            const splitCount = stateMgr.state.splits?.[editTargetBay] || 1;
            if (splitCount > 1) {
                stateMgr.update({ [`splits.${editTargetBay}`]: splitCount - 1 });
            }
            bayEditOverlay.classList.add('hidden');
        };

        bayResetBtn.onclick = () => {
            if (!editTargetBay) return;
            if (confirm(`No.${editTargetBay} に割り当てられている商品をすべて未割り当てに戻しますか？`)) {
                stateMgr.resetBay(editTargetBay);
            }
            bayEditOverlay.classList.add('hidden');
        };

        const showBayEditMenu = (b, state) => {
            editTargetBay = b;
            editBayTitle.textContent = `No.${b} の設定`;
            
            const splitCount = state.splits?.[b] || 1;
            const maxSplit = 6;
            const slots = state.slots || {};
            const isLastEmpty = !slots[`${b}-${splitCount}`];

            bayAddSplitBtn.disabled = splitCount >= maxSplit;
            bayAddSplitBtn.style.opacity = splitCount >= maxSplit ? "0.5" : "1";
            
            bayRemoveSplitBtn.disabled = !(splitCount > 1 && isLastEmpty);
            bayRemoveSplitBtn.style.opacity = bayRemoveSplitBtn.disabled ? "0.5" : "1";
            
            bayEditOverlay.classList.remove('hidden');
        };

        // --- Render Helpers ---

        const getPickColor = (s) => {
            const colors = ['#2563eb', '#16a34a', '#d97706', '#db2777', '#8b5cf6', '#06b6d4', '#f43f5e', '#84cc16', '#64748b'];
            return colors[(s - 1) % colors.length];
        };

        const getGridClass = (splitCount, orientation) => {
            if (splitCount === 1) return 'grid-split-1';
            if (splitCount === 2) return orientation === 'portrait' ? 'grid-split-2-p' : 'grid-split-2-l';
            if (splitCount === 3) return 'grid-split-3'; // Both landscape and portrait same layout
            if (splitCount === 4) return 'grid-split-4';
            if (splitCount === 5) return orientation === 'portrait' ? 'grid-split-5-p' : 'grid-split-5-l';
            return orientation === 'portrait' ? 'grid-split-6-p' : 'grid-split-6-l';
        };

        const showSlotSkusModal = (b, s, skus, stateMgr) => {
            let overlay = document.getElementById('slotSkusOverlay');
            if (overlay) overlay.remove();

            overlay = document.createElement('div');
            overlay.id = 'slotSkusOverlay';
            overlay.className = 'overlay';
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '1000';

            const modal = document.createElement('div');
            modal.style.background = '#1e293b';
            modal.style.padding = '2rem';
            modal.style.borderRadius = '12px';
            modal.style.minWidth = '300px';
            modal.style.maxWidth = '90%';
            modal.style.color = 'white';

            modal.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                    <h3 style="margin:0;">No.${b}-${s} 投入済みSKU</h3>
                    <button class="btn btn-outline close-btn" style="padding:4px 8px;">✕</button>
                </div>
                <div id="skusList" style="display:flex; flex-direction:column; gap:0.5rem; max-height: 300px; overflow-y:auto; margin-bottom:1.5rem;">
                </div>
            `;

            const listContainer = modal.querySelector('#skusList');
            skus.forEach(jan => {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.background = '#334155';
                item.style.padding = '0.75rem';
                item.style.borderRadius = '6px';
                
                item.innerHTML = `
                    <span style="font-family:monospace; font-weight:700;">${jan}</span>
                    <button class="btn btn-danger remove-sku-btn" data-jan="${jan}" style="padding:0.25rem 0.75rem; font-size:0.8rem;">解除</button>
                `;
                listContainer.appendChild(item);
            });

            if (skus.length === 0) {
                listContainer.innerHTML = '<div style="color:#94a3b8; text-align:center;">（空です）</div>';
            }

            modal.querySelector('.close-btn').onclick = () => overlay.remove();

            modal.querySelectorAll('.remove-sku-btn').forEach(btn => {
                btn.onclick = () => {
                    const targetJan = btn.getAttribute('data-jan');
                    if (confirm(`JAN: ${targetJan}\nこのSKUを未割り当てに戻しますか？`)) {
                        stateMgr.unassignSlot(`${b}-${s}`, targetJan);
                        overlay.remove();
                    }
                };
            });

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        };

        const markSlotDone = (slotKey, state, stateMgr) => {
            const listId = state.currentPickingNo;
            if (!listId) return;
            const lines = [...state.pickLists[listId]];
            let changed = false;

            lines.forEach(l => {
                if (l.status === 'DONE') return;
                
                const entry = Object.entries(state.slots || {}).find(([k, v]) => {
                    const skus = v.skus || (v.sku ? [v.sku] : []);
                    return skus.includes(l.jan);
                });
                const lineSlotKey = entry ? entry[0] : 'UNALLOCATED';

                if (lineSlotKey === slotKey) {
                    l.status = 'DONE';
                    changed = true;
                }
            });

            if (changed) {
                const updates = {
                    [`pickLists.${listId}`]: lines
                };

                const allDone = lines.every(l => l.status === 'DONE');
                if (allDone) {
                    new Audio('audio/complete.mp3').play().catch(e => console.log(e));
                    updates.activePick = {};
                } else {
                    const newActivePick = {};
                    lines.forEach(l => {
                        const entry = Object.entries(state.slots || {}).find(([k, v]) => {
                            const skus = v.skus || (v.sku ? [v.sku] : []);
                            return skus.includes(l.jan);
                        });
                        const lSlotKey = entry ? entry[0] : 'UNALLOCATED';

                        if (!newActivePick[lSlotKey]) {
                            newActivePick[lSlotKey] = { totalQty: 0, pendingQty: 0, skus: [], pickNo: listId };
                        }
                        newActivePick[lSlotKey].totalQty += l.qty;
                        if (l.status !== 'DONE') {
                            newActivePick[lSlotKey].pendingQty += l.qty;
                        }
                        if (!newActivePick[lSlotKey].skus.includes(l.jan)) {
                            newActivePick[lSlotKey].skus.push(l.jan);
                        }
                    });
                    updates.activePick = newActivePick;
                }
                stateMgr.update(updates);
            }
        };

        const renderBayContent = (b, state, isSingleView = false) => {
            const isConfigured = state.splits?.[b] !== undefined;
            const splitCount = isConfigured ? state.splits[b] : 1;
            const orientation = state.config?.orientation || 'portrait';
            const isInjectPending = state.mode === 'INJECT' && state.injectPending && state.injectPending.status === 'WAITING_SLOT';

            const screen = document.createElement('div');
            screen.className = 'mobile-screen';
            screen.innerHTML = `
                <div class="screen-header">
                    <span>No.${b}</span>
                    <span class="live-badge">● LIVE</span>
                </div>
            `;

            const body = document.createElement('div');
            body.className = `screen-body ${getGridClass(splitCount, orientation)}`;

            for (let s = 1; s <= splitCount; s++) {
                const slotKey = `${b}-${s}`;
                const slotData = state.slots?.[slotKey];
                const pickData = state.activePick?.[slotKey];

                const block = document.createElement('div');
                block.className = 'block';

                // Detailed Grid Placement (Bottom-heavy numbers)
                if (orientation === 'portrait') {
                    if (splitCount === 2) {
                        if (s === 2) { block.style.gridRow = '1'; block.style.gridColumn = '1'; }
                        if (s === 1) { block.style.gridRow = '2'; block.style.gridColumn = '1'; }
                    } else if (splitCount === 3) {
                        if (s === 3) { block.style.gridRow = '1'; block.style.gridColumn = '1 / span 2'; }
                        if (s === 1) { block.style.gridRow = '2'; block.style.gridColumn = '1'; }
                        if (s === 2) { block.style.gridRow = '2'; block.style.gridColumn = '2'; }
                    } else if (splitCount === 4) {
                        if (s === 3) { block.style.gridRow = '1'; block.style.gridColumn = '1'; }
                        if (s === 4) { block.style.gridRow = '1'; block.style.gridColumn = '2'; }
                        if (s === 1) { block.style.gridRow = '2'; block.style.gridColumn = '1'; }
                        if (s === 2) { block.style.gridRow = '2'; block.style.gridColumn = '2'; }
                    } else if (splitCount === 5) {
                        if (s === 5) { block.style.gridRow = '1'; block.style.gridColumn = '1 / span 2'; }
                        if (s === 3) { block.style.gridRow = '2'; block.style.gridColumn = '1'; }
                        if (s === 4) { block.style.gridRow = '2'; block.style.gridColumn = '2'; }
                        if (s === 1) { block.style.gridRow = '3'; block.style.gridColumn = '1'; }
                        if (s === 2) { block.style.gridRow = '3'; block.style.gridColumn = '2'; }
                    } else if (splitCount === 6) {
                        if (s === 5) { block.style.gridRow = '1'; block.style.gridColumn = '1'; }
                        if (s === 6) { block.style.gridRow = '1'; block.style.gridColumn = '2'; }
                        if (s === 3) { block.style.gridRow = '2'; block.style.gridColumn = '1'; }
                        if (s === 4) { block.style.gridRow = '2'; block.style.gridColumn = '2'; }
                        if (s === 1) { block.style.gridRow = '3'; block.style.gridColumn = '1'; }
                        if (s === 2) { block.style.gridRow = '3'; block.style.gridColumn = '2'; }
                    }
                } else {
                    // Landscape
                    if (splitCount === 2) {
                        if (s === 2) { block.style.gridRow = '1'; block.style.gridColumn = '1'; }
                        if (s === 1) { block.style.gridRow = '1'; block.style.gridColumn = '2'; }
                    } else if (splitCount === 3) {
                        if (s === 3) { block.style.gridRow = '1'; block.style.gridColumn = '1 / span 2'; }
                        if (s === 1) { block.style.gridRow = '2'; block.style.gridColumn = '1'; }
                        if (s === 2) { block.style.gridRow = '2'; block.style.gridColumn = '2'; }
                    } else if (splitCount === 4) {
                        if (s === 3) { block.style.gridRow = '1'; block.style.gridColumn = '1'; }
                        if (s === 4) { block.style.gridRow = '2'; block.style.gridColumn = '1'; }
                        if (s === 1) { block.style.gridRow = '1'; block.style.gridColumn = '2'; }
                        if (s === 2) { block.style.gridRow = '2'; block.style.gridColumn = '2'; }
                    } else if (splitCount === 5) {
                        if (s === 5) { block.style.gridRow = '1 / span 2'; block.style.gridColumn = '1'; }
                        if (s === 3) { block.style.gridRow = '1'; block.style.gridColumn = '2'; }
                        if (s === 4) { block.style.gridRow = '2'; block.style.gridColumn = '2'; }
                        if (s === 1) { block.style.gridRow = '1'; block.style.gridColumn = '3'; }
                        if (s === 2) { block.style.gridRow = '2'; block.style.gridColumn = '3'; }
                    } else if (splitCount === 6) {
                        if (s === 5) { block.style.gridRow = '1'; block.style.gridColumn = '1'; }
                        if (s === 6) { block.style.gridRow = '2'; block.style.gridColumn = '1'; }
                        if (s === 3) { block.style.gridRow = '1'; block.style.gridColumn = '2'; }
                        if (s === 4) { block.style.gridRow = '2'; block.style.gridColumn = '2'; }
                        if (s === 1) { block.style.gridRow = '1'; block.style.gridColumn = '3'; }
                        if (s === 2) { block.style.gridRow = '2'; block.style.gridColumn = '3'; }
                    }
                }

                const isPickingTarget = state.mode === 'PICK' && pickData;
                const isInjectReady = state.mode === 'INJECT' && isInjectPending && isConfigured;

                const skus = slotData ? (slotData.skus || (slotData.sku ? [slotData.sku] : [])) : [];

                if (isPickingTarget) {
                    block.style.flexDirection = 'column';
                    if (pickData.pendingQty === 0) {
                        block.classList.add('picking-done');
                        if (pickData.skus && pickData.skus.length >= 1) {
                            block.innerHTML = `
                                <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">完了済: ${pickData.skus.length} SKU</div>
                                <div style="line-height: 1; font-weight: 900;">${pickData.totalQty || pickData.qty}</div>
                            `;
                        } else {
                            const targetJan = pickData.skus ? pickData.skus[0] : (skus[0] || '----');
                            block.innerHTML = `
                                <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">...${targetJan.slice(-4)}</div>
                                <div style="line-height: 1; font-weight: 900;">${pickData.totalQty || pickData.qty}</div>
                            `;
                        }
                    } else {
                        block.classList.add('picking');
                        if (pickData.skus && pickData.skus.length >= 1) {
                            block.innerHTML = `
                                <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">対象: ${pickData.skus.length} SKU</div>
                                <div style="line-height: 1; font-weight: 900;">${pickData.pendingQty}</div>
                            `;
                        } else {
                            const targetJan = pickData.skus ? pickData.skus[0] : (skus[0] || '----');
                            block.innerHTML = `
                                <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">...${targetJan.slice(-4)}</div>
                                <div style="line-height: 1; font-weight: 900;">${pickData.pendingQty}</div>
                            `;
                        }
                        block.onclick = (e) => {
                            e.stopPropagation();
                            markSlotDone(slotKey, state, stateMgr);
                        };
                    }
                    block.style.setProperty('--pick-color', getPickColor(s));
                } else if (skus.length > 0) {
                    if (state.mode === 'PICK') {
                        block.classList.add('grayed-out');
                        if (skus.length === 1) {
                            block.textContent = "..." + skus[0].slice(-4);
                        } else {
                            block.textContent = `${skus.length} SKU`;
                        }
                    } else {
                        block.classList.add('filled');
                        if (skus.length === 1) {
                            block.textContent = "..." + skus[0].slice(-4);
                        } else {
                            block.textContent = `${skus.length} SKU`;
                        }
                        
                        block.style.cursor = 'pointer';
                        block.onclick = (e) => {
                            e.stopPropagation();
                            if (state.mode === 'INJECT') {
                                if (isInjectPending) {
                                    stateMgr.selectSlot(b, s);
                                } else {
                                    showSlotSkusModal(b, s, skus, stateMgr);
                                }
                            }
                        };
                    }
                    block.style.setProperty('--pick-color', getPickColor(s));
                } else if (isInjectReady) {
                    block.classList.add('inject-ready');
                    block.textContent = 'TAP';
                    block.style.setProperty('--pick-color', '#3b82f6');
                    block.onclick = (e) => {
                        e.stopPropagation();
                        stateMgr.selectSlot(b, s);
                    };
                } else {
                    block.textContent = s;
                }
                body.appendChild(block);
            }
            screen.appendChild(body);

            // Controls (Inject Mode Setup)
            if (state.mode === 'INJECT') {
                if (!isConfigured) {
                    const setup = document.createElement('div');
                    setup.className = 'setup-needed';
                    setup.innerHTML = `
                        <div style="font-weight:800; font-size:0.75rem; color:${isInjectPending ? '#f87171' : 'white'}; margin-bottom:8px;">未設定</div>
                        <button class="btn-setup">初期化</button>
                    `;
                    setup.querySelector('.btn-setup').onclick = () => stateMgr.update({ [`splits.${b}`]: 1 });
                    screen.appendChild(setup);
                } else {
                    const controls = document.createElement('div');
                    controls.className = 'config-overlay';
                    controls.style.display = 'flex';
                    controls.style.gap = '8px';

                    if (isSingleView) {
                        const minusBtn = document.createElement('button');
                        minusBtn.className = 'btn-round';
                        minusBtn.innerHTML = '－';
                        minusBtn.style.fontSize = '14px';
                        minusBtn.style.background = 'rgba(0, 0, 0, 0.6)';
                        const isLastEmpty = !state.slots?.[`${b}-${splitCount}`];
                        if (splitCount <= 1 || !isLastEmpty) {
                            minusBtn.classList.add('disabled');
                        } else {
                            minusBtn.onclick = (e) => {
                                e.stopPropagation();
                                stateMgr.update({ [`splits.${b}`]: splitCount - 1 });
                            };
                        }
                        controls.appendChild(minusBtn);

                        const plusBtn = document.createElement('button');
                        plusBtn.className = 'btn-round';
                        plusBtn.innerHTML = '＋';
                        plusBtn.style.fontSize = '14px';
                        plusBtn.style.background = 'rgba(0, 0, 0, 0.6)';
                        const maxSplit = 6;
                        if (splitCount >= maxSplit) {
                            plusBtn.classList.add('disabled');
                        } else {
                            plusBtn.onclick = (e) => {
                                e.stopPropagation();
                                stateMgr.update({ [`splits.${b}`]: splitCount + 1 });
                            };
                        }
                        controls.appendChild(plusBtn);
                    }

                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn-round';
                    editBtn.innerHTML = '⚙️';
                    editBtn.style.fontSize = '14px';
                    editBtn.style.background = 'rgba(0, 0, 0, 0.6)';
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        showBayEditMenu(b, state);
                    };
                    controls.appendChild(editBtn);
                    screen.appendChild(controls);
                }
            }

            return screen;
        };

        const renderBay10 = (state) => {
            const injectList = state.injectList || {};
            const slots = state.slots || {};
            const allocatedSkus = new Set();
            Object.values(slots).forEach(slot => {
                const skus = slot.skus || (slot.sku ? [slot.sku] : []);
                skus.forEach(sku => allocatedSkus.add(sku));
            });
            const unallocatedCount = Object.keys(injectList).filter(jan => !allocatedSkus.has(jan)).length;
            const nextBayNo = (state.config?.bays || 9) + 1;
            const pickData = state.activePick?.['UNALLOCATED'];
            const isPickingTarget = state.mode === 'PICK' && pickData;
            const isDone = isPickingTarget && pickData.pendingQty === 0;

            bay10Container.innerHTML = `
                <div class="mobile-screen" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border: 1px solid ${isPickingTarget ? (isDone ? '#eab308' : '#eab308') : '#334155'}; border-radius: 6px; background: ${isPickingTarget ? (isDone ? '#000000' : '#ca8a04') : '#1e293b'}; color: ${isPickingTarget && isDone ? '#eab308' : 'white'};">
                    <div style="display: flex; flex-direction: column;">
                        <span style="color: ${isPickingTarget ? (isDone ? '#ca8a04' : '#fefce8') : '#94a3b8'}; font-size: 0.7rem; font-weight: 800;">No.${nextBayNo}</span>
                        <span style="font-size: 1.1rem; font-weight: 800;">その他（未割り当て）</span>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        ${isPickingTarget ? `<span style="font-size: 1rem; font-weight: 800; background: ${isDone ? 'transparent' : '#fef08a'}; border: ${isDone ? '2px solid #ca8a04' : 'none'}; color: ${isDone ? '#ca8a04' : '#854d0e'}; padding: 2px 8px; border-radius: 12px; margin-right: 4px;">${isDone ? '完了' : 'PICK対象'}</span>` : ''}
                        <span style="color: ${isPickingTarget ? (isDone ? '#eab308' : 'white') : '#f59e0b'}; font-size: 2rem; font-weight: 800; line-height: 1;">${unallocatedCount}</span>
                        <span style="color: ${isPickingTarget ? (isDone ? '#ca8a04' : '#fefce8') : '#64748b'}; font-size: 0.8rem; font-weight: 800;">SKU</span>
                    </div>
                </div>
            `;
            bay10Container.classList.remove('hidden');
        };

        // --- Main Render Logic ---

        const renderUnallocatedDetail = (state) => {
            const injectList = state.injectList || {};
            const slots = state.slots || {};
            const allocatedSkus = new Set();
            Object.values(slots).forEach(slot => {
                const skus = slot.skus || (slot.sku ? [slot.sku] : []);
                skus.forEach(sku => allocatedSkus.add(sku));
            });
            const unallocatedKeys = Object.keys(injectList).filter(jan => !allocatedSkus.has(jan));
            const skuCount = unallocatedKeys.length;
            const totalQty = unallocatedKeys.reduce((sum, jan) => sum + injectList[jan], 0);

            const container = document.createElement('div');
            container.className = 'mobile-screen';
            const nextBayNo = (state.config?.bays || 9) + 1;
            const isPickingTarget = state.mode === 'PICK' && state.activePick?.['UNALLOCATED'];

            container.innerHTML = `
                <div class="screen-header">
                    <span>No.${nextBayNo} (その他)</span>
                    <span class="live-badge">● LIVE</span>
                </div>
            `;

            const body = document.createElement('div');
            body.className = 'screen-body grid-split-1';

            const block = document.createElement('div');
            block.className = 'block';

            if (isPickingTarget) {
                const pickData = state.activePick['UNALLOCATED'];
                block.style.flexDirection = 'column';
                if (pickData.pendingQty === 0) {
                    block.classList.add('picking-done');
                    if (pickData.skus && pickData.skus.length >= 1) {
                        block.innerHTML = `
                            <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">完了済: ${pickData.skus.length} SKU</div>
                            <div style="line-height: 1; font-weight: 900;">${pickData.totalQty}</div>
                        `;
                    } else {
                        const targetJan = pickData.skus ? pickData.skus[0] : '----';
                        block.innerHTML = `
                            <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">...${targetJan.slice(-4)}</div>
                            <div style="line-height: 1; font-weight: 900;">${pickData.totalQty}</div>
                        `;
                    }
                    block.style.setProperty('--pick-color', '#eab308');
                } else {
                    block.classList.add('picking');
                    if (pickData.skus && pickData.skus.length >= 1) {
                        block.innerHTML = `
                            <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">対象: ${pickData.skus.length} SKU</div>
                            <div style="line-height: 1; font-weight: 900;">${pickData.pendingQty}</div>
                        `;
                    } else {
                        const targetJan = pickData.skus ? pickData.skus[0] : '----';
                        block.innerHTML = `
                            <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">...${targetJan.slice(-4)}</div>
                            <div style="line-height: 1; font-weight: 900;">${pickData.pendingQty}</div>
                        `;
                    }
                    block.style.setProperty('--pick-color', '#eab308');
                    block.onclick = (e) => {
                        e.stopPropagation();
                        markSlotDone('UNALLOCATED', state, stateMgr);
                    };
                }
            } else if (skuCount > 0) {
                if (state.mode === 'PICK') block.classList.add('grayed-out');
                else block.classList.add('filled');
                block.style.flexDirection = 'column';
                block.innerHTML = `
                    <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">${skuCount} SKU</div>
                    <div style="line-height: 1; font-weight: 900;">${totalQty} 個</div>
                `;
                block.style.setProperty('--pick-color', '#334155');
            } else {
                block.textContent = "空";
            }
            
            body.appendChild(block);
            container.appendChild(body);
            return container;
        };

        const render = (state) => {
            if (!state) return;
            const config = state.config || {};

            if (!config.bays) {
                showSetup(false);
                wallHeader.classList.add('hidden');
                multiViewContainer.classList.add('hidden');
                selectorViewContainer.classList.add('hidden');
                singleViewContainer.classList.add('hidden');
                bay10Container.classList.add('hidden');
                homeBtn.classList.remove('hidden');
                return;
            }

            hideSetup();
            wallHeader.classList.remove('hidden');
            homeBtn.classList.add('hidden'); // hidden behind wall header to save space

            if (currentSingleBayId !== null) {
                // SHOW DETAIL
                const isUnallocated = currentSingleBayId === 'unallocated';
                const nextBayNo = config.bays + 1;
                wallTitle.textContent = isUnallocated ? `No.${nextBayNo} その他` : `No.${currentSingleBayId} 詳細`;
                
                backBtn.classList.remove('hidden');
                multiViewContainer.classList.add('hidden');
                selectorViewContainer.classList.add('hidden');
                singleViewContainer.classList.remove('hidden');
                bay10Container.classList.add('hidden');

                singleViewContainer.innerHTML = '';
                if (isUnallocated) {
                    singleViewContainer.appendChild(renderUnallocatedDetail(state));
                } else {
                    singleViewContainer.appendChild(renderBayContent(currentSingleBayId, state, true));
                }
            } else if (config.viewMode === 'multi') {
                // Feature: MULTI VIEW
                wallTitle.textContent = "全間口一覧";
                backBtn.classList.add('hidden');
                multiViewContainer.classList.remove('hidden');
                selectorViewContainer.classList.add('hidden');
                singleViewContainer.classList.add('hidden');
                
                // Show Unallocated bay at the bottom
                renderBay10(state);
                bay10Container.onclick = () => {
                    currentSingleBayId = 'unallocated';
                    render(stateMgr.state);
                };

                const r = config.multiRows || 3;
                const c = config.multiCols || 3;
                const start = config.multiStartId || 1;
                const end = Math.min(config.bays, start + (r * c) - 1);

                multiViewContainer.style.gridTemplateColumns = `repeat(${c}, 1fr)`;
                multiViewContainer.style.gridTemplateRows = `repeat(${r}, 1fr)`;
                multiViewContainer.innerHTML = '';

                for (let b = start; b <= end; b++) {
                    multiViewContainer.appendChild(renderBayContent(b, state, false));
                }

            } else {
                // Feature: SINGLE VIEW (Selector)
                wallTitle.textContent = "間口選択";
                backBtn.classList.add('hidden');
                multiViewContainer.classList.add('hidden');
                selectorViewContainer.classList.remove('hidden');
                singleViewContainer.classList.add('hidden');
                bay10Container.classList.add('hidden');
                
                selectorViewContainer.innerHTML = '';
                for (let b = 1; b <= config.bays; b++) {
                    const btn = document.createElement('div');
                    btn.className = 'selector-btn';
                    btn.textContent = `No.${b}`;
                    btn.onclick = () => {
                        currentSingleBayId = b;
                        render(stateMgr.state);
                    };
                    selectorViewContainer.appendChild(btn);
                }
                
                const nextBayNo = config.bays + 1;
                const injectList = state.injectList || {};
                const slots = state.slots || {};
                const allocatedSkus = new Set();
                Object.values(slots).forEach(slot => {
                    const skus = slot.skus || (slot.sku ? [slot.sku] : []);
                    skus.forEach(sku => allocatedSkus.add(sku));
                });
                const unallocatedCount = Object.keys(injectList).filter(jan => !allocatedSkus.has(jan)).length;
                const isPickingTarget = state.mode === 'PICK' && state.activePick?.['UNALLOCATED'];

                const othersBtn = document.createElement('div');
                othersBtn.className = 'selector-btn';
                const pickDataOthers = state.activePick?.['UNALLOCATED'];
                const isPickingTargetOthers = state.mode === 'PICK' && pickDataOthers;
                const othersDone = isPickingTargetOthers && pickDataOthers.pendingQty === 0;

                if (isPickingTargetOthers) {
                    othersBtn.style.background = othersDone ? 'black' : '#eab308';
                    othersBtn.style.color = othersDone ? '#eab308' : 'white';
                    othersBtn.style.border = othersDone ? '2px solid #eab308' : '2px solid #fef08a';
                }
                othersBtn.style.gridColumn = '1 / -1';
                othersBtn.style.display = 'flex';
                othersBtn.style.flexDirection = 'row';
                othersBtn.style.justifyContent = 'space-between';
                othersBtn.style.alignItems = 'center';
                othersBtn.style.padding = '1.5rem';
                othersBtn.innerHTML = `
                    <div style="text-align: left; display:flex; flex-direction:column; align-items:flex-start;">
                        <span style="color: ${isPickingTargetOthers ? (othersDone ? '#ca8a04' : '#fefce8') : '#94a3b8'}; font-size: 0.8rem; font-weight: 800;">No.${nextBayNo}</span>
                        <span style="color: ${isPickingTargetOthers && othersDone ? '#eab308' : 'white'}; font-size: 1.2rem; font-weight: 800;">その他（未割り当て）</span>
                    </div>
                    <div style="display:flex; align-items:baseline; gap:0.5rem;">
                        ${isPickingTargetOthers ? `<span style="font-size: 0.9rem; font-weight: 800; background: ${othersDone ? 'transparent' : 'white'}; border: ${othersDone ? '2px solid #eab308' : 'none'}; color: ${othersDone ? '#eab308' : '#ca8a04'}; padding: 2px 6px; border-radius: 8px;">${othersDone ? '完了' : '対象'}</span>` : ''}
                        <span style="font-size: 1.8rem; font-weight: 900; color: ${isPickingTargetOthers ? (othersDone ? '#eab308' : 'white') : '#f59e0b'};">${unallocatedCount}</span>
                        <span style="color:${isPickingTargetOthers ? (othersDone ? '#ca8a04' : '#fefce8') : '#94a3b8'}; font-size:0.8rem; font-weight:700;">SKU</span>
                    </div>
                `;
                othersBtn.onclick = () => {
                    currentSingleBayId = 'unallocated';
                    render(stateMgr.state);
                };
                selectorViewContainer.appendChild(othersBtn);
            }
        };

        backBtn.addEventListener('click', () => {
            currentSingleBayId = null;
            render(stateMgr.state);
        });

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                const page = link.getAttribute('data-page');
                window.location.href = page;
            });
        });
    });
})();
