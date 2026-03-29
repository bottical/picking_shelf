// Inject Mode Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const bayGrid = document.getElementById('bayGrid');
        const scanInput = document.getElementById('scanInput');
        const scanMsg = document.getElementById('scanMsg');
        const loadCsvBtn = document.getElementById('loadCsvBtn');
        const instPanel = document.getElementById('instructionPanel');
        const sessionDisplay = document.getElementById('sessionDisplay');

        const stateMgr = new StateManager(
            (state) => {
                render(state);
                updateUIState(state);
                updateUserSelectorUI();
            },
            (user) => {
                if (user) {
                    sessionDisplay.textContent = `USER: ${user.email}`;
                } else {
                    window.location.href = 'index.html';
                }
            }
        );

        const cancelInjectBtn = document.getElementById('cancelInjectBtn');
        if (cancelInjectBtn) {
            cancelInjectBtn.addEventListener('click', () => {
                stateMgr.update({
                    [`userStates.${stateMgr.currentUserId}.injectPending`]: null
                });
                stateMgr.clearLocalInjectPending();
            });
        }

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


        const normalizeJan = (jan) => {
            if (!jan) return "";
            let s = jan.trim().replace(/\r/g, '');
            s = s.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
            return s;
        };
        let lastAcceptedJan = null;
        let lastAcceptedAt = 0;

        function parseCsvLine(line) {
            const result = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const next = line[i + 1];

                if (char === '"') {
                    if (inQuotes && next === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    result.push(current);
                    current = '';
                } else {
                    current += char;
                }
            }

            result.push(current);
            return result.map(v => v.trim());
        }

        const buildJanToSlotMap = (slots) => {
            const janToSlot = {};
            Object.entries(slots || {}).forEach(([slotKey, slot]) => {
                const skus = slot.skus || (slot.sku ? [slot.sku] : []);
                skus.forEach((jan) => {
                    janToSlot[jan] = slotKey;
                });
            });
            return janToSlot;
        };

        const getMergedSlots = (state) => {
            const baseSlots = { ...(state.slots || {}) };
            const optimisticSlots = stateMgr.localUiState.optimisticSlots || {};
            Object.entries(optimisticSlots).forEach(([slotKey, optimisticSlot]) => {
                if (!optimisticSlot) return;
                baseSlots[slotKey] = { skus: [...(optimisticSlot.skus || [])] };
            });
            return baseSlots;
        };

        const isJanAssignedSomewhere = (state, jan) => {
            if (!jan) return false;
            const mergedSlots = getMergedSlots(state);
            return Object.values(mergedSlots).some((slot) => {
                const skus = slot?.skus || (slot?.sku ? [slot.sku] : []);
                return skus.includes(jan);
            });
        };

        let lastIsWaiting = false;
        let lastWaitingJan = null;
        let lastWaitingJanWasAssigned = false;
        const getEffectiveInjectPending = (state) => {
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            return currentUserState.injectPending || stateMgr.localUiState.injectPendingPreview;
        };

        const updateUIState = (state) => {
            const pending = getEffectiveInjectPending(state);
            const isWaiting = pending && pending.status === "WAITING_SLOT";

            if (isWaiting) {
                lastWaitingJan = pending.jan || null;
                lastWaitingJanWasAssigned = isJanAssignedSomewhere(state, pending.jan);
                instPanel.classList.remove('hidden');
                scanInput.disabled = true;
                scanInput.value = pending.jan;
                scanInput.parentElement.style.opacity = '0.5';

                const totalQty = state.injectList?.[pending.jan] || 0;
                document.getElementById('dashJan').textContent = pending.jan;
                document.getElementById('dashQty').textContent = totalQty;
                scanMsg.classList.add('hidden');
            } else {
                if (lastIsWaiting) {
                    const assignedNow = isJanAssignedSomewhere(state, lastWaitingJan);
                    const success = !lastWaitingJanWasAssigned && assignedNow;
                    if (success) {
                        AudioManager.playStartSound();
                    }
                    scanInput.value = '';
                    setTimeout(() => scanInput.focus(), 100);
                }

                instPanel.classList.add('hidden');
                scanInput.disabled = false;
                scanInput.parentElement.style.opacity = '1';
                if (scanMsg.classList.contains('info')) {
                    scanMsg.classList.add('hidden');
                }
            }
            lastIsWaiting = isWaiting;
            if (!isWaiting) {
                lastWaitingJan = null;
                lastWaitingJanWasAssigned = false;
            }
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

        const render = (state) => {
            bayGrid.innerHTML = '';
            const mergedSlots = getMergedSlots(state);
            const totalBays = state.config?.bays || 9;
            for (let b = 1; b <= totalBays; b++) {
                const splits = state.splits?.[b];
                const isConfigured = splits !== undefined;

                const bayCard = document.createElement('div');
                bayCard.className = 'card bay-card';
                bayCard.innerHTML = `<div style="text-align:center; font-weight:800; color:var(--text-muted); font-size:0.8rem;">No.${b}</div>`;

                const slotContainer = document.createElement('div');
                slotContainer.className = 'slot-container';

                if (!isConfigured) {
                    slotContainer.innerHTML = `<div style="grid-column:span 2; grid-row:span 2; display:flex; align-items:center; justify-content:center; background:#f8fafc; color:#cbd5e1; font-size:0.75rem; border:2px dashed #e2e8f0; border-radius:0.5rem;">スマホ未設定</div>`;
                } else {
                    // Update grid templates dynamically for PC view based on splits (max 6, mapping to portrait layout)
                    if (splits === 1) { slotContainer.style.gridTemplateColumns = '1fr'; slotContainer.style.gridTemplateRows = '1fr'; }
                    else if (splits === 2) { slotContainer.style.gridTemplateColumns = '1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr'; }
                    else if (splits === 3) { slotContainer.style.gridTemplateColumns = '1fr 1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr'; }
                    else if (splits === 4) { slotContainer.style.gridTemplateColumns = '1fr 1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr'; }
                    else if (splits === 5) { slotContainer.style.gridTemplateColumns = '1fr 1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr 1fr'; }
                    else { slotContainer.style.gridTemplateColumns = '1fr 1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr 1fr'; }

                    for (let s = 1; s <= splits; s++) {
                        const slotKey = `${b}-${s}`;
                        const slotData = mergedSlots[slotKey];
                        const slot = document.createElement('div');
                        slot.className = 'slot';

                        // Detailed Grid Placement (Bottom-heavy numbers)
                        if (splits === 2) {
                            if (s === 2) { slot.style.gridRow = '1'; slot.style.gridColumn = '1'; }
                            if (s === 1) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                        } else if (splits === 3) {
                            if (s === 3) { slot.style.gridRow = '1'; slot.style.gridColumn = '1 / span 2'; }
                            if (s === 1) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                            if (s === 2) { slot.style.gridRow = '2'; slot.style.gridColumn = '2'; }
                        } else if (splits === 4) {
                            if (s === 3) { slot.style.gridRow = '1'; slot.style.gridColumn = '1'; }
                            if (s === 4) { slot.style.gridRow = '1'; slot.style.gridColumn = '2'; }
                            if (s === 1) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                            if (s === 2) { slot.style.gridRow = '2'; slot.style.gridColumn = '2'; }
                        } else if (splits === 5) {
                            if (s === 5) { slot.style.gridRow = '1'; slot.style.gridColumn = '1 / span 2'; }
                            if (s === 3) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                            if (s === 4) { slot.style.gridRow = '2'; slot.style.gridColumn = '2'; }
                            if (s === 1) { slot.style.gridRow = '3'; slot.style.gridColumn = '1'; }
                            if (s === 2) { slot.style.gridRow = '3'; slot.style.gridColumn = '2'; }
                        } else if (splits === 6) {
                            if (s === 5) { slot.style.gridRow = '1'; slot.style.gridColumn = '1'; }
                            if (s === 6) { slot.style.gridRow = '1'; slot.style.gridColumn = '2'; }
                            if (s === 3) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                            if (s === 4) { slot.style.gridRow = '2'; slot.style.gridColumn = '2'; }
                            if (s === 1) { slot.style.gridRow = '3'; slot.style.gridColumn = '1'; }
                            if (s === 2) { slot.style.gridRow = '3'; slot.style.gridColumn = '2'; }
                        }

                        if (slotData) {
                            slot.classList.add('filled');
                            slot.style.background = `hsl(${(s - 1) * 60 + 200}, 70%, 50%)`;
                            
                            const skus = slotData.skus || (slotData.sku ? [slotData.sku] : []);
                            if (skus.length === 1) {
                                slot.textContent = "..." + skus[0].slice(-4);
                            } else {
                                slot.textContent = `${skus.length} SKU`;
                            }

                            slot.style.cursor = 'pointer';
                            slot.onclick = () => {
                                showSlotSkusModal(b, s, skus, stateMgr);
                            };
                        } else {
                            slot.textContent = '空';
                        }
                        slotContainer.appendChild(slot);
                    }
                }
                bayCard.appendChild(slotContainer);
                bayGrid.appendChild(bayCard);
            }

            // Render BAY 10 (Unallocated SKUs)
            const bay10Container = document.getElementById('bay10Container');
            if (bay10Container) {
                const injectList = state.injectList || {};
                const slots = mergedSlots;
                
                // Get all SKUs currently in slots
                const allocatedSkus = new Set();
                Object.values(slots).forEach(slot => {
                    const skus = slot.skus || (slot.sku ? [slot.sku] : []);
                    skus.forEach(sku => allocatedSkus.add(sku));
                });
                
                // Count SKUs in injectList that are NOT in slots
                const unallocatedCount = Object.keys(injectList).filter(jan => !allocatedSkus.has(jan)).length;
                const nextBayNo = (state.config?.bays || 9) + 1;

                bay10Container.innerHTML = `
                    <div class="card" style="background: #f8fafc; border: 2px dashed #cbd5e1; text-align: center; padding: 1.5rem;">
                        <div style="font-size: 0.875rem; color: var(--text-muted); font-weight: 800; margin-bottom: 0.5rem;">No.${nextBayNo}</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--text);">その他（未割り当て）</div>
                        <div style="font-size: 2.5rem; font-weight: 800; color: var(--warning); margin-top: 0.5rem;">
                            ${unallocatedCount} <span style="font-size: 1rem; color: var(--text-muted);">SKU</span>
                        </div>
                    </div>
                `;
            }
        };

        const showMessage = (text, type) => {
            scanMsg.textContent = text;
            scanMsg.className = `alert ${type}`;
            scanMsg.classList.remove('hidden');
        };

        const csvConfigBtn = document.getElementById('csvConfigBtn');
        const csvConfigModal = document.getElementById('csvConfigModal');
        const csvConfigCancel = document.getElementById('csvConfigCancel');
        const csvConfigSave = document.getElementById('csvConfigSave');
        const csvSkipHeader = document.getElementById('csvSkipHeader');
        const csvColPick = document.getElementById('csvColPick');
        const csvColJan = document.getElementById('csvColJan');
        const csvColQty = document.getElementById('csvColQty');

        const getSavedCsvFormat = () => {
            if (stateMgr.user && stateMgr.user.uid) {
                const saved = localStorage.getItem(`csvFormat_${stateMgr.user.uid}`);
                if (saved) {
                    try { return JSON.parse(saved); } catch (e) {}
                }
            }
            return stateMgr.state?.config?.csvFormat || { skipHeader: true, pickCol: 1, janCol: 2, qtyCol: 3 };
        };

        const saveCsvFormat = (format) => {
            if (stateMgr.user && stateMgr.user.uid) {
                localStorage.setItem(`csvFormat_${stateMgr.user.uid}`, JSON.stringify(format));
            }
            const currentConfig = stateMgr.state?.config || {};
            stateMgr.update({ config: { ...currentConfig, csvFormat: format } });
        };

        csvConfigBtn.addEventListener('click', () => {
            const format = getSavedCsvFormat();
            csvSkipHeader.checked = format.skipHeader;
            csvColPick.value = format.pickCol;
            csvColJan.value = format.janCol;
            csvColQty.value = format.qtyCol;
            csvConfigModal.classList.remove('hidden');
        });

        csvConfigCancel.addEventListener('click', () => {
            csvConfigModal.classList.add('hidden');
        });

        csvConfigSave.addEventListener('click', () => {
            const format = {
                skipHeader: csvSkipHeader.checked,
                pickCol: parseInt(csvColPick.value, 10) || 1,
                janCol: parseInt(csvColJan.value, 10) || 2,
                qtyCol: parseInt(csvColQty.value, 10) || 3
            };
            saveCsvFormat(format);
            csvConfigModal.classList.add('hidden');
            alert('CSVの列取り込み設定を更新しました。');
        });

        loadCsvBtn.addEventListener('click', () => {
            const file = document.getElementById('csvFile').files[0];
            if (!file) return alert("ファイルを選択してください");

            const format = getSavedCsvFormat();
            const idxPick = format.pickCol - 1;
            const idxJan = format.janCol - 1;
            const idxQty = format.qtyCol - 1;

            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                const lines = text.split(/\r?\n/).filter(x => x.trim());

                if (format.skipHeader && lines.length > 0) lines.shift();

                const aggregatedInject = {};
                const groupedPick = {};

                lines.forEach(line => {
                    const parts = parseCsvLine(line);
                    const maxIdx = Math.max(idxPick, idxJan, idxQty);
                    if (parts.length <= maxIdx) return;

                    const pickNo = String(parts[idxPick] ?? '').trim();
                    const jan = normalizeJan(String(parts[idxJan] ?? '').trim());
                    const qtyRaw = String(parts[idxQty] ?? '').trim();
                    const qty = parseInt(qtyRaw, 10) || 0;

                    if (!jan || !pickNo) return;

                    // Aggregate for Injection validation
                    aggregatedInject[jan] = (aggregatedInject[jan] || 0) + qty;

                    // Group for Picking Lists
                    if (!groupedPick[pickNo]) groupedPick[pickNo] = [];
                    groupedPick[pickNo].push({ jan, qty, status: 'PENDING' });
                });

                const updates = {
                    injectList: aggregatedInject,
                    pickLists: groupedPick
                };
                const currentSplits = stateMgr.state?.splits || {};
                const newSplits = { ...currentSplits };
                let needInit = false;
                const totalBays = stateMgr.state?.config?.bays || 9;
                for (let b = 1; b <= totalBays; b++) {
                    if (newSplits[b] === undefined) {
                        newSplits[b] = 1;
                        needInit = true;
                    }
                }
                if (needInit) updates.splits = newSplits;

                stateMgr.update(updates);
                alert(`${Object.keys(aggregatedInject).length} 品目のデータを読み込みました。\nピッキングリスト: ${Object.keys(groupedPick).length} 件`);
            };
            reader.readAsText(file);
        });

        scanInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                if (scanInput.disabled) return;
                const jan = normalizeJan(scanInput.value);
                const state = stateMgr.state;
                const totalQty = state.injectList?.[jan];

                if (!jan || totalQty === undefined) {
                    AudioManager.playErrorSound();
                    showMessage(`❌ SKU ${jan} はリストにありません`, 'error');
                } else {
                    const janToSlot = buildJanToSlotMap(getMergedSlots(state));
                    const alreadyInSlot = !!janToSlot[jan];

                    if (alreadyInSlot) {
                        AudioManager.playErrorSound();
                        showMessage(`⚠️ SKU ${jan} は既に枠に投入済みです`, 'error');
                    } else {
                        const now = Date.now();
                        if (lastAcceptedJan === jan && (now - lastAcceptedAt) < 500) {
                            scanInput.value = '';
                            return;
                        }
                        lastAcceptedJan = jan;
                        lastAcceptedAt = now;
                        const requestId = stateMgr.createInjectRequestId();
                        const pending = {
                            jan,
                            status: "WAITING_SLOT",
                            requestedAt: Date.now(),
                            requestId
                        };
                        stateMgr.setLocalInjectPending(pending);
                        scanInput.disabled = true;
                        scanInput.parentElement.style.opacity = '0.5';
                        showMessage(`✅ SKU ${jan} を受け付けました。投入先の枠をタップしてください。`, 'info');
                        try {
                            await stateMgr.cancelAllPicks({
                                [`userStates.${stateMgr.currentUserId}.injectPending`]: {
                                    ...pending
                                }
                            });
                        } catch (error) {
                            console.error('injectPending の保存に失敗しました:', error);
                            stateMgr.rollbackOptimisticInject();
                            scanInput.disabled = false;
                            scanInput.parentElement.style.opacity = '1';
                            AudioManager.playErrorSound();
                            showMessage('❌ 通信エラーにより投入待機を保存できませんでした。再度スキャンしてください。', 'error');
                        }
                    }
                }
                scanInput.value = '';
            }
        });

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                const page = link.getAttribute('data-page');
                window.location.href = page;
            });
        });
    });
})();
