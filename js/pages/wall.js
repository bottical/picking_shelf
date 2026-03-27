// Mobile Wall Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const wallHeader = document.getElementById('wallHeader');
        const wallTitle = document.getElementById('wallTitle');
        const backBtn = document.getElementById('backBtn');
        const openSettingsBtn = document.getElementById('openSettingsBtn');
        const openOthersBtn = document.getElementById('openOthersBtn');
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
        const settingBulkSplit = document.getElementById('settingBulkSplit');
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');
        const DEVICE_SETTINGS_KEY = 'picking_shelf_wall_device_settings_v1';

        const getDeviceWallSettings = () => {
            try {
                return JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY) || '{}');
            } catch (e) {
                return {};
            }
        };

        const saveDeviceWallSettings = (partial) => {
            const current = getDeviceWallSettings();
            const next = { ...current, ...partial };
            localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(next));
            return next;
        };

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
            (state) => {
                render(state);
                updateUserSelectorUI();
            },
            (user) => {
                if (!user) window.location.href = 'index.html';
            }
        );

        const updateUserSelectorUI = () => {
            const userSelect = document.getElementById('userSelect');
            if (userSelect) {
                userSelect.value = stateMgr.currentUserId;
                const uIdx = stateMgr.currentUserId.slice(-1);
                userSelect.style.borderColor = `var(--user${uIdx})`;
                userSelect.style.color = `var(--user${uIdx})`;
                userSelect.style.backgroundColor = `rgba(255, 255, 255, 0.05)`;
            }
        };

        const userSelect = document.getElementById('userSelect');
        if (userSelect) {
            userSelect.addEventListener('change', (e) => {
                stateMgr.setCurrentUser(e.target.value);
            });
        }

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
            const deviceSettings = getDeviceWallSettings();
            settingMultiStartId.value = deviceSettings.multiStartId || cfg.multiStartId || 1;
            settingBulkSplit.value = '';
            document.getElementById('settingShowOthers').checked = cfg.showOthers !== false;
            settingViewMode.dispatchEvent(new Event('change'));
        };

        const hideSetup = () => setupOverlay.classList.add('hidden');

        openSettingsBtn.addEventListener('click', () => showSetup(true));
        if (openOthersBtn) {
            openOthersBtn.addEventListener('click', () => {
                currentSingleBayId = 'unallocated';
                render(stateMgr.state);
            });
        }
        closeSettingsBtn.addEventListener('click', () => hideSetup());

        saveSettingsBtn.addEventListener('click', async () => {
            const newConfig = {
                bays: parseInt(settingBays.value, 10) || 9,
                viewMode: settingViewMode.value,
                orientation: settingOrientation.value,
                multiRows: parseInt(settingMultiRows.value, 10) || 3,
                multiCols: parseInt(settingMultiCols.value, 10) || 3,
                showOthers: document.getElementById('settingShowOthers').checked,
                maxSplit: 6
            };
            const localMultiStartId = Math.max(1, parseInt(settingMultiStartId.value, 10) || 1);
            saveDeviceWallSettings({ multiStartId: localMultiStartId });

            try {
                await stateMgr.update({ config: newConfig });

                const bulkSplit = parseInt(settingBulkSplit.value, 10);
                if (bulkSplit >= 1 && bulkSplit <= 6) {
                    const result = await stateMgr.applyBulkSplitCount(bulkSplit);
                    if (result) {
                        alert(`一括分割設定を適用しました（変更 ${result.changedBays} 間口 / 制約で据え置き ${result.constrainedBays} 間口）`);
                    }
                }

                hideSetup();
                currentSingleBayId = null; // reset to selector if in single mode
                render(stateMgr.state);
            } catch (error) {
                console.error('設定の保存に失敗しました:', error);
                alert('設定の保存に失敗しました。通信状態をご確認ください。');
            }
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

        const SLOT_LAYOUTS = {
            portrait: {
                2: {
                    2: { row: '1', column: '1' },
                    1: { row: '2', column: '1' }
                },
                3: {
                    3: { row: '1', column: '1 / span 2' },
                    1: { row: '2', column: '1' },
                    2: { row: '2', column: '2' }
                },
                4: {
                    3: { row: '1', column: '1' },
                    4: { row: '1', column: '2' },
                    1: { row: '2', column: '1' },
                    2: { row: '2', column: '2' }
                },
                5: {
                    5: { row: '1', column: '1 / span 2' },
                    3: { row: '2', column: '1' },
                    4: { row: '2', column: '2' },
                    1: { row: '3', column: '1' },
                    2: { row: '3', column: '2' }
                },
                6: {
                    5: { row: '1', column: '1' },
                    6: { row: '1', column: '2' },
                    3: { row: '2', column: '1' },
                    4: { row: '2', column: '2' },
                    1: { row: '3', column: '1' },
                    2: { row: '3', column: '2' }
                }
            },
            landscape: {
                2: {
                    2: { row: '1', column: '1' },
                    1: { row: '1', column: '2' }
                },
                3: {
                    3: { row: '1', column: '1 / span 2' },
                    1: { row: '2', column: '1' },
                    2: { row: '2', column: '2' }
                },
                4: {
                    3: { row: '1', column: '1' },
                    4: { row: '2', column: '1' },
                    1: { row: '1', column: '2' },
                    2: { row: '2', column: '2' }
                },
                5: {
                    5: { row: '1 / span 2', column: '1' },
                    3: { row: '1', column: '2' },
                    4: { row: '2', column: '2' },
                    1: { row: '1', column: '3' },
                    2: { row: '2', column: '3' }
                },
                6: {
                    5: { row: '1', column: '1' },
                    6: { row: '2', column: '1' },
                    3: { row: '1', column: '2' },
                    4: { row: '2', column: '2' },
                    1: { row: '1', column: '3' },
                    2: { row: '2', column: '3' }
                }
            }
        };

        const getSlotPlacement = (splitCount, slotNo, orientation) => {
            const orientationLayouts = SLOT_LAYOUTS[orientation];
            if (!orientationLayouts) return null;
            return orientationLayouts[splitCount]?.[slotNo] || null;
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
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const listId = currentUserState.currentPickingNo;
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
                    AudioManager.playCompleteSound();
                    updates[`userStates.${stateMgr.currentUserId}.activePick`] = {};
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
                    updates[`userStates.${stateMgr.currentUserId}.activePick`] = newActivePick;
                }
                stateMgr.update(updates);
            }
        };

        const getIndicators = (state, slotKey) => {
            const config = state.config || {};
            const showOthers = config.showOthers !== false;
            const indicators = [];

            const userStates = state.userStates || {};
            Object.keys(userStates).forEach(uId => {
                const uIdx = uId.slice(-1);
                const isMe = uId === stateMgr.currentUserId;
                if (!isMe && !showOthers) return;

                const uState = userStates[uId];
                
                // Picking Indicator
                const pickData = uState.activePick?.[slotKey];
                if (pickData && pickData.pendingQty > 0) {
                    indicators.push({ type: 'PICK', uId, uIdx, colorIdx: uIdx, qty: pickData.pendingQty, isMe });
                }

                // Injection Indicator
                const injectPending = uState.injectPending;
                if (injectPending && injectPending.status === 'WAITING_SLOT') {
                    // If we want to show which slot is being targeted for injection, 
                    // we need to know if this slot was the one scanned/selected.
                    // For now, if it's "WAITING_SLOT", we show it on all configured slots
                    // OR if we implement a specific targetSlot field in injectPending.
                }
            });
            return indicators;
        };

        const renderBayContent = (b, state, isSingleView = false) => {
            const isConfigured = state.splits?.[b] !== undefined;
            const splitCount = isConfigured ? state.splits[b] : 1;
            const orientation = state.config?.orientation || 'portrait';
            
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const myActivePick = currentUserState.activePick || {};
            const isUserPickingAnywhere = Object.values(myActivePick).some(p => p.pendingQty > 0);
            const isInjectPending = state.mode === 'INJECT' && currentUserState.injectPending && currentUserState.injectPending.status === 'WAITING_SLOT';

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
                
                const indicators = getIndicators(state, slotKey);
                const myPickData = myActivePick[slotKey];
                const isTargetForMe = myPickData && myPickData.pendingQty > 0;

                const block = document.createElement('div');
                block.className = 'block';
                if (isUserPickingAnywhere && !isTargetForMe) {
                    block.classList.add('grayed-out');
                }

                const placement = getSlotPlacement(splitCount, s, orientation);
                if (placement?.row) block.style.gridRow = placement.row;
                if (placement?.column) block.style.gridColumn = placement.column;

                const skus = slotData ? (slotData.skus || (slotData.sku ? [slotData.sku] : [])) : [];
                const isInjectReady = state.mode === 'INJECT' && isInjectPending && isConfigured;

                if (indicators.length > 0) {
                    block.style.flexDirection = 'column';
                    
                    const myInd = indicators.find(ind => ind.isMe);
                    if (myInd && myInd.type === 'PICK') {
                        block.classList.add('picking');
                        block.classList.add(`pulse-user-${stateMgr.currentUserId.slice(-1)}`);
                        const pickLabel = skus.length === 1 ? "..." + skus[0].slice(-4) : `対象: ${myPickData.skus.length} SKU`;
                        block.innerHTML = `
                            <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">${pickLabel}</div>
                            <div style="line-height: 1; font-weight: 900;">${myPickData.pendingQty}</div>
                        `;
                        block.onclick = (e) => {
                            e.stopPropagation();
                            markSlotDone(slotKey, state, stateMgr);
                        };
                    } else {
                        // Show multi-user indicators
                        const indContainer = document.createElement('div');
                        indContainer.className = 'indicator-container';
                        indicators.forEach(ind => {
                            const dot = document.createElement('div');
                            dot.className = `user-dot user-dot-${ind.uIdx}`;
                            dot.textContent = ind.uIdx;
                            indContainer.appendChild(dot);
                        });
                        block.appendChild(indContainer);

                        const primaryInd = indicators[0];
                        block.classList.add(`pulse-user-${primaryInd.colorIdx}`);
                        
                        const infoDiv = document.createElement('div');
                        infoDiv.style.marginTop = 'auto';
                        if (skus.length > 0) {
                            infoDiv.textContent = skus.length === 1 ? "..." + skus[0].slice(-4) : `${skus.length} SKU`;
                        } else {
                            infoDiv.textContent = s;
                        }
                        block.appendChild(infoDiv);
                    }
                    block.style.setProperty('--pick-color', getPickColor(s));
                } else if (myPickData && myPickData.pendingQty === 0) {
                    block.style.flexDirection = 'column';
                    block.classList.add('picking-done');
                    const doneLabel = skus.length === 1 ? "..." + skus[0].slice(-4) : `完了済: ${myPickData.skus.length} SKU`;
                    block.innerHTML = `
                        <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">${doneLabel}</div>
                        <div style="line-height: 1; font-weight: 900;">${myPickData.totalQty}</div>
                    `;
                    block.style.setProperty('--pick-color', getPickColor(s));
                } else if (skus.length > 0) {
                    block.classList.add('filled');
                    block.style.cursor = 'pointer';
                    block.onclick = (e) => {
                        e.stopPropagation();
                        if (isInjectPending) stateMgr.selectSlot(b, s);
                        else showSlotSkusModal(b, s, skus, stateMgr);
                    };
                    if (skus.length === 1) {
                        const totalQty = state.injectList?.[skus[0]] || 0;
                        block.style.flexDirection = 'column';
                        block.innerHTML = `
                            <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">...${skus[0].slice(-4)}</div>
                            <div style="line-height: 1; font-weight: 900;">${totalQty}</div>
                        `;
                    } else {
                        block.textContent = `${skus.length} SKU`;
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
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const myActivePick = currentUserState.activePick || {};
            const isUserPickingAnywhere = Object.values(myActivePick).some(p => p.pendingQty > 0);

            const indicators = getIndicators(state, 'UNALLOCATED');
            const myPick = indicators.find(ind => ind.isMe);
            const isTargetForMe = myPick && myPick.qty > 0;
            const isAnyPick = indicators.length > 0;
            const isDone = myPick && myPick.qty === 0;

            const blackoutClass = (isUserPickingAnywhere && !isTargetForMe) ? 'grayed-out' : '';
            const bgColor = myPick ? (isDone ? '#000000' : '#ca8a04') : (isAnyPick ? '#334155' : '#1e293b');
            const borderColor = isAnyPick ? '#eab308' : '#334155';

            bay10Container.innerHTML = `
                <div class="mobile-screen ${blackoutClass}" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border: 1px solid ${borderColor}; border-radius: 6px; background: ${bgColor}; color: white; position: relative;">
                    <div style="display: flex; flex-direction: column;">
                        <span style="color: #94a3b8; font-size: 0.7rem; font-weight: 800;">No.${nextBayNo}</span>
                        <span style="font-size: 1.1rem; font-weight: 800;">その他（未割り当て）</span>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        ${myPick ? `<span style="font-size: 1rem; font-weight: 800; background: ${isDone ? 'transparent' : '#fef08a'}; border: ${isDone ? '2px solid #ca8a04' : 'none'}; color: ${isDone ? '#ca8a04' : '#854d0e'}; padding: 2px 8px; border-radius: 12px; margin-right: 4px;">${isDone ? '完了' : 'PICK対象'}</span>` : ''}
                        <span style="color: ${isAnyPick ? 'white' : '#f59e0b'}; font-size: 2rem; font-weight: 800; line-height: 1;">${unallocatedCount}</span>
                        <span style="color: #94a3b8; font-size: 0.8rem; font-weight: 800;">SKU</span>
                    </div>
                    <div class="indicator-container" style="top:2px; right:2px;">
                        ${indicators.map(ind => `<div class="user-dot user-dot-${ind.uIdx}">${ind.uIdx}</div>`).join('')}
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
            const indicators = getIndicators(state, 'UNALLOCATED');
            const isAnyPick = indicators.length > 0;

            container.innerHTML = `
                <div class="screen-header">
                    <span>No.${nextBayNo} (その他)</span>
                    <span class="live-badge">● LIVE</span>
                </div>
            `;

            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const myActivePick = currentUserState.activePick || {};
            const isUserPickingAnywhere = Object.values(myActivePick).some(p => p.pendingQty > 0);
            
            const myPick = indicators.find(ind => ind.isMe);
            const isTargetForMe = myPick && myPick.qty > 0;

            const body = document.createElement('div');
            body.className = 'screen-body grid-split-1';

            const block = document.createElement('div');
            block.className = 'block';
            if (isUserPickingAnywhere && !isTargetForMe) {
                block.classList.add('grayed-out');
            }

            if (isAnyPick) {
                block.style.flexDirection = 'column';
                if (myPick) {
                    if (myPick.qty === 0) {
                        block.classList.add('picking-done');
                        block.innerHTML = `
                            <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">完了済</div>
                            <div style="line-height: 1; font-weight: 900;">OK</div>
                        `;
                        block.style.setProperty('--pick-color', '#eab308');
                    } else {
                        block.classList.add('picking');
                        block.innerHTML = `
                            <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">対象: ${myPick.qty} 個</div>
                            <div style="line-height: 1; font-weight: 900;">SCAN / TAP</div>
                        `;
                        block.style.setProperty('--pick-color', '#eab308');
                        block.onclick = (e) => {
                            e.stopPropagation();
                            markSlotDone('UNALLOCATED', state, stateMgr);
                        };
                    }
                } else {
                    const primaryInd = indicators[0];
                    block.classList.add(`pulse-user-${primaryInd.colorIdx}`);
                    block.innerHTML = `
                        <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">他ユーザー作業中</div>
                        <div style="line-height: 1; font-weight: 900;">${skuCount} SKU</div>
                    `;
                }
                const indContainer = document.createElement('div');
                indContainer.className = 'indicator-container';
                indicators.forEach(ind => {
                    const dot = document.createElement('div');
                    dot.className = `user-dot user-dot-${ind.uIdx}`;
                    dot.textContent = ind.uIdx;
                    indContainer.appendChild(dot);
                });
                block.appendChild(indContainer);
            } else if (skuCount > 0) {
                block.classList.add('filled');
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

        const updateInstructionBanner = (state) => {
            const banner = document.getElementById('instructionBanner');
            if (!banner) return;

            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const inject = currentUserState.injectPending;

            if (inject && inject.status === 'WAITING_SLOT') {
                const uIdx = stateMgr.currentUserId.slice(-1);
                banner.className = `instruction-banner user-bg-${uIdx}`;
                banner.innerHTML = `
                    <div style="display:flex; justify-content:center; align-items:center; gap:1rem;">
                        <span>📥 <b>User ${uIdx}</b>: 商品 <b>${inject.jan}</b> を投入する間口をタップしてください</span>
                        <button id="bannerCancelBtn" style="background:rgba(0,0,0,0.3); border:1px solid white; color:white; padding:4px 8px; border-radius:4px; font-size:0.8rem;">キャンセル</button>
                    </div>
                `;
                banner.classList.remove('hidden');
                document.getElementById('bannerCancelBtn').onclick = () => {
                    stateMgr.updateUserState(stateMgr.currentUserId, { injectPending: null });
                };
            } else {
                banner.classList.add('hidden');
                banner.innerHTML = '';
            }
        };

        const render = (state) => {
            if (!state) return;
            updateInstructionBanner(state);
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
                if (openOthersBtn) {
                    if (isUnallocated) openOthersBtn.classList.add('hidden');
                    else openOthersBtn.classList.remove('hidden');
                }
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
                if (openOthersBtn) openOthersBtn.classList.remove('hidden');
                // Feature: MULTI VIEW
                wallTitle.textContent = "全間口一覧";
                backBtn.classList.add('hidden');
                multiViewContainer.classList.remove('hidden');
                selectorViewContainer.classList.add('hidden');
                singleViewContainer.classList.add('hidden');
                bay10Container.classList.add('hidden');

                const r = config.multiRows || 3;
                const c = config.multiCols || 3;
                const deviceSettings = getDeviceWallSettings();
                const start = Math.max(1, parseInt(deviceSettings.multiStartId, 10) || 1);
                const totalBays = config.bays || 0;
                const maxStart = Math.max(1, totalBays - (r * c) + 1);
                const normalizedStart = Math.min(Math.max(1, start), maxStart);
                const end = Math.min(config.bays, normalizedStart + (r * c) - 1);

                multiViewContainer.style.gridTemplateColumns = `repeat(${c}, 1fr)`;
                multiViewContainer.style.gridTemplateRows = `repeat(${r}, 1fr)`;
                multiViewContainer.innerHTML = '';

                for (let b = normalizedStart; b <= end; b++) {
                    multiViewContainer.appendChild(renderBayContent(b, state, false));
                }

            } else {
                if (openOthersBtn) openOthersBtn.classList.add('hidden');
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
                    btn.style.position = 'relative';

                    // Check for any user indicators in any slot of this bay
                    let bayPickFound = false;
                    let bayDone = true;
                    const bayIndicators = [];
                    const splitCount = state.splits?.[b] || 1;
                    const activePicks = [];
                    for (let s = 1; s <= splitCount; s++) {
                        const slotInds = getIndicators(state, `${b}-${s}`);
                        slotInds.forEach(ind => {
                            if (!bayIndicators.find(i => i.uIdx === ind.uIdx)) bayIndicators.push(ind);
                            if (ind.type === 'PICK') {
                                bayPickFound = true;
                                if (ind.qty > 0) bayDone = false;
                            }
                        });
                    }

                    if (bayPickFound) {
                        btn.style.background = bayDone ? 'black' : '#eab308';
                        btn.style.color = bayDone ? '#eab308' : 'white';
                        btn.style.border = bayDone ? '2px solid #eab308' : '2px solid #fef08a';
                    }

                    btn.textContent = `No.${b}`;
                    if (bayIndicators.length > 0) {
                        const indContainer = document.createElement('div');
                        indContainer.className = 'indicator-container';
                        indContainer.style.top = '2px';
                        indContainer.style.right = '2px';
                        bayIndicators.forEach(ind => {
                            const dot = document.createElement('div');
                            dot.className = `user-dot user-dot-${ind.uIdx}`;
                            dot.style.width = '8px';
                            dot.style.height = '8px';
                            dot.style.fontSize = '0'; // skip text inside dot for selector
                            indContainer.appendChild(dot);
                        });
                        btn.appendChild(indContainer);
                    }

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
                
                const othersIndicators = getIndicators(state, 'UNALLOCATED');
                const othersPickFound = othersIndicators.some(ind => ind.type === 'PICK');
                const othersDone = othersPickFound && othersIndicators.every(ind => ind.type !== 'PICK' || ind.qty === 0);

                const othersBtn = document.createElement('div');
                othersBtn.className = 'selector-btn';
                othersBtn.style.position = 'relative';

                if (othersPickFound) {
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
                        <span style="color: ${othersPickFound ? (othersDone ? '#ca8a04' : '#fefce8') : '#94a3b8'}; font-size: 0.8rem; font-weight: 800;">No.${nextBayNo}</span>
                        <span style="color: ${othersPickFound && othersDone ? '#eab308' : 'white'}; font-size: 1.2rem; font-weight: 800;">その他（未割り当て）</span>
                    </div>
                    <div style="display:flex; align-items:baseline; gap:0.5rem;">
                        ${othersPickFound ? `<span style="font-size: 0.9rem; font-weight: 800; background: ${othersDone ? 'transparent' : 'white'}; border: ${othersDone ? '2px solid #eab308' : 'none'}; color: ${othersDone ? '#eab308' : '#ca8a04'}; padding: 2px 6px; border-radius: 8px;">${othersDone ? '完了' : '対象'}</span>` : ''}
                        <span style="font-size: 1.8rem; font-weight: 900; color: ${othersPickFound ? (othersDone ? '#eab308' : 'white') : '#f59e0b'};">${unallocatedCount}</span>
                        <span style="color:${othersPickFound ? (othersDone ? '#ca8a04' : '#fefce8') : '#94a3b8'}; font-size:0.8rem; font-weight:700;">SKU</span>
                    </div>
                    <div class="indicator-container" style="top:4px; right:4px;">
                        ${othersIndicators.map(ind => `<div class="user-dot user-dot-${ind.uIdx}">${ind.uIdx}</div>`).join('')}
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
