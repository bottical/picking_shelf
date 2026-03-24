// Inject Mode Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const bayGrid = document.getElementById('bayGrid');
        const scanInput = document.getElementById('scanInput');
        const scanMsg = document.getElementById('scanMsg');
        const csvInput = document.getElementById('csvInput');
        const loadCsvBtn = document.getElementById('loadCsvBtn');
        const instPanel = document.getElementById('instructionPanel');
        const sessionDisplay = document.getElementById('sessionDisplay');

        const stateMgr = new StateManager(
            (state) => {
                render(state);
                updateUIState(state);
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
                stateMgr.update({ injectPending: firebase.firestore.FieldValue.delete() });
            });
        }

        // Ensure we are in INJECT mode when this page is loaded
        stateMgr.update({ mode: 'INJECT' });

        const normalizeJan = (jan) => {
            if (!jan) return "";
            let s = jan.trim().replace(/\r/g, '');
            s = s.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
            return s;
        };

        const updateUIState = (state) => {
            const pending = state.injectPending;
            const isWaiting = pending && pending.status === "WAITING_SLOT";

            if (isWaiting) {
                instPanel.classList.remove('hidden');
                scanInput.disabled = true;
                scanInput.value = pending.jan;
                // スマホ用に入力欄のエリアを少しグレーダウンしてフォーカス外れを表現
                scanInput.parentElement.style.opacity = '0.5';
                
                const totalQty = state.injectList?.[pending.jan] || 0;
                
                // ダッシュボードへのデータ注入
                document.getElementById('dashJan').textContent = pending.jan;
                document.getElementById('dashQty').textContent = totalQty;
                
                // 既存のメッセージアラートは非表示にする
                scanMsg.classList.add('hidden');
            } else {
                instPanel.classList.add('hidden');
                scanInput.disabled = false;
                scanInput.parentElement.style.opacity = '1';
                if (scanMsg.classList.contains('info')) {
                    scanMsg.classList.add('hidden');
                    scanInput.value = '';
                    scanInput.focus();
                }
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
                        const slotData = state.slots?.[slotKey];
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
                const slots = state.slots || {};
                
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

        csvConfigBtn.addEventListener('click', () => {
            const format = stateMgr.state?.config?.csvFormat || { skipHeader: true, pickCol: 1, janCol: 2, qtyCol: 3 };
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
            const currentConfig = stateMgr.state?.config || {};
            stateMgr.update({ config: { ...currentConfig, csvFormat: format } });
            csvConfigModal.classList.add('hidden');
            alert('CSVの列取り込み設定を更新しました。');
        });

        loadCsvBtn.addEventListener('click', () => {
            const file = document.getElementById('csvFile').files[0];
            if (!file) return alert("ファイルを選択してください");

            const format = stateMgr.state?.config?.csvFormat || { skipHeader: true, pickCol: 1, janCol: 2, qtyCol: 3 };
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
                    const parts = line.split(',');
                    const maxIdx = Math.max(idxPick, idxJan, idxQty);
                    if (parts.length <= maxIdx) return;

                    const pickNo = parts[idxPick].trim();
                    const jan = normalizeJan(parts[idxJan]);
                    const qty = parseInt(parts[idxQty]) || 0;

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

        scanInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const jan = normalizeJan(scanInput.value);
                const state = stateMgr.state;
                const totalQty = state.injectList?.[jan];

                if (totalQty === undefined) {
                    showMessage(`❌ SKU ${jan} はリストにありません`, 'error');
                } else {
                    let alreadyInSlot = false;
                    Object.values(state.slots || {}).forEach(slot => {
                        const skus = slot.skus || (slot.sku ? [slot.sku] : []);
                        if (skus.includes(jan)) alreadyInSlot = true;
                    });

                    if (alreadyInSlot) {
                        showMessage(`⚠️ SKU ${jan} は既に枠に投入済みです`, 'error');
                    } else {
                        // 状態更新のみ。showMessageを使用すると、ダッシュボード側のUI制御と競合して表示されてしまうため呼ばない。
                        stateMgr.update({
                            injectPending: { jan, status: "WAITING_SLOT", requestedAt: Date.now() }
                        });
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
