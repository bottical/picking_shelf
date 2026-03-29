// StateManager (Non-module version)
// Depends on firebase-app.js, firebase-auth.js, and firebase-firestore.js (compat versions)

function StateManager(onStateChange, onUserChange) {
    this.onStateChange = onStateChange;
    this.onUserChange = onUserChange;
    this.user = null;
    this.state = null;
    this.unsubscribeState = null;

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    this.auth = firebase.auth();
    this.db = firebase.firestore();

    this.auth.onAuthStateChanged((user) => {
        this.user = user;
        if (this.onUserChange) this.onUserChange(user);

        if (user) {
            this.subscribeToState(user.uid);
        } else {
            if (this.unsubscribeState) this.unsubscribeState();
            this.state = null;
        }
    });

    // Local state for the current session/user
    this.currentUserId = localStorage.getItem('picking_shelf_user_id') || 'user1';
    this.localUiState = {
        injectPendingPreview: null,
        cancelledInjectRequestIds: {},
        optimisticSlots: {},
        lastOpSeq: 0
    };
}

StateManager.prototype.setCurrentUser = function (userId) {
    this.currentUserId = userId;
    localStorage.setItem('picking_shelf_user_id', userId);
    if (this.state && this.onStateChange) this.onStateChange(this.state);
};

StateManager.prototype._notifyUiOnlyChange = function () {
    if (this.state && this.onStateChange) this.onStateChange(this.state);
};

StateManager.prototype.setLocalInjectPending = function (jan) {
    if (!jan) {
        this.localUiState.injectPendingPreview = null;
    } else if (typeof jan === 'string') {
        this.localUiState.injectPendingPreview = {
            jan,
            status: 'WAITING_SLOT',
            requestedAt: Date.now(),
            requestId: this.createInjectRequestId()
        };
    } else {
        this.localUiState.injectPendingPreview = {
            jan: jan.jan,
            status: jan.status || 'WAITING_SLOT',
            requestedAt: jan.requestedAt || Date.now(),
            requestId: jan.requestId || this.createInjectRequestId()
        };
    }
    this._notifyUiOnlyChange();
};

StateManager.prototype.clearLocalInjectPending = function () {
    this.localUiState.injectPendingPreview = null;
    this._notifyUiOnlyChange();
};

StateManager.prototype.isInjectRequestCancelled = function (requestId) {
    if (!requestId) return false;
    return !!(this.localUiState.cancelledInjectRequestIds && this.localUiState.cancelledInjectRequestIds[requestId]);
};

StateManager.prototype.getEffectiveInjectPendingForCurrentUser = function (state) {
    const targetState = state || this.state || {};
    const currentUserState = targetState.userStates?.[this.currentUserId] || {};

    const remotePending = currentUserState.injectPending || null;
    const remoteCancelled = currentUserState.injectPendingCancelled || null;
    const localPending = this.localUiState.injectPendingPreview || null;

    const remoteRequestId = remotePending?.requestId || null;
    const remoteCancelledLocally = this.isInjectRequestCancelled(remoteRequestId);
    const remoteCancelledRemotely =
        !!remotePending &&
        !!remoteCancelled &&
        !!remoteCancelled.requestId &&
        remoteCancelled.requestId === remoteRequestId;

    if (remotePending && !remoteCancelledLocally && !remoteCancelledRemotely) {
        return remotePending;
    }

    return localPending || null;
};

StateManager.prototype.hasEffectiveInjectPendingForCurrentUser = function (state) {
    return !!this.getEffectiveInjectPendingForCurrentUser(state);
};

StateManager.prototype.cancelInjectPending = function () {
    if (!this.user) return Promise.reject("Not authenticated");
    const uid = this.user.uid;
    const docRef = this._getStateDocRef(uid);
    const currentUserId = this.currentUserId;
    const localPending = this.localUiState.injectPendingPreview || null;

    return this.db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const data = doc.exists ? (doc.data() || {}) : {};
        const currentUserState = data.userStates?.[currentUserId] || {};
        const remotePending = currentUserState.injectPending || null;
        const remoteCancelled = currentUserState.injectPendingCancelled || null;
        const pending = remotePending || localPending;
        const requestId = pending?.requestId || null;
        const cancelledAt = Date.now();

        console.debug('[inject-cancel] transaction compare-and-set', {
            currentUserId,
            requestId,
            remotePendingRequestId: remotePending?.requestId || null,
            remoteCancelledRequestId: remoteCancelled?.requestId || null
        });

        const updates = {
            [`userStates.${currentUserId}.injectPending`]: null
        };

        if (!pending) {
            updates[`userStates.${currentUserId}.injectPendingCancelled`] = null;
            transaction.update(docRef, updates);
            return { requestId: null, jan: null, cancelledAt: null };
        }

        updates[`userStates.${currentUserId}.injectPendingCancelled`] = {
            requestId,
            jan: pending?.jan || null,
            cancelledAt
        };
        transaction.update(docRef, updates);
        return { requestId, jan: pending?.jan || null, cancelledAt };
    }).then((result) => {
        const requestId = result?.requestId || null;
        if (requestId) {
            this.localUiState.cancelledInjectRequestIds[requestId] = {
                jan: result?.jan || null,
                cancelledAt: result?.cancelledAt || Date.now()
            };
        }
        this.clearLocalInjectPending();
        return result;
    }).catch((error) => {
        this._logFirestoreError('cancelInjectPending', error, uid);
        throw error;
    });
};

StateManager.prototype.createInjectRequestId = function () {
    return `inject-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

StateManager.prototype.setOptimisticSlot = function (slotKey, jan) {
    if (!slotKey || !jan) return;
    const opId = `inject-op-${Date.now()}-${++this.localUiState.lastOpSeq}`;
    const currentSlots = this.state?.slots || {};
    const previousSlotData = currentSlots[slotKey]
        ? { skus: [...(currentSlots[slotKey].skus || (currentSlots[slotKey].sku ? [currentSlots[slotKey].sku] : []))] }
        : null;

    const nextSkus = previousSlotData ? [...previousSlotData.skus] : [];
    if (!nextSkus.includes(jan)) {
        nextSkus.push(jan);
    }

    this.localUiState.optimisticSlots[slotKey] = {
        skus: nextSkus,
        _meta: {
            opId,
            status: 'pending',
            createdAt: Date.now(),
            jan,
            previousSlotData
        }
    };
    this._notifyUiOnlyChange();
    return opId;
};

StateManager.prototype.markOptimisticSlotCommitted = function (slotKey, opId) {
    const slot = this.localUiState.optimisticSlots[slotKey];
    if (!slot || !slot._meta) return;
    if (opId && slot._meta.opId !== opId) return;
    slot._meta.status = 'committed';
    slot._meta.committedAt = Date.now();
    this._notifyUiOnlyChange();
};

StateManager.prototype.clearOptimisticSlot = function (slotKey, opId) {
    if (!slotKey) return;
    const slot = this.localUiState.optimisticSlots[slotKey];
    if (opId && slot?._meta?.opId !== opId) return;
    delete this.localUiState.optimisticSlots[slotKey];
    this._notifyUiOnlyChange();
};

StateManager.prototype.rollbackOptimisticInject = function (opId) {
    this.localUiState.injectPendingPreview = null;
    if (!opId) {
        this.localUiState.optimisticSlots = {};
    } else {
        Object.keys(this.localUiState.optimisticSlots || {}).forEach((slotKey) => {
            const slot = this.localUiState.optimisticSlots[slotKey];
            if (slot?._meta?.opId === opId) {
                delete this.localUiState.optimisticSlots[slotKey];
            }
        });
    }
    this._notifyUiOnlyChange();
};

StateManager.prototype._reconcileLocalUiStateWithRemote = function (remoteState) {
    const remoteSlots = remoteState?.slots || {};
    const optimisticSlots = this.localUiState.optimisticSlots || {};
    const remoteUserPending = remoteState?.userStates?.[this.currentUserId]?.injectPending;
    const remoteCancelledInfo = remoteState?.userStates?.[this.currentUserId]?.injectPendingCancelled || null;
    const remotePendingRequestId = remoteUserPending?.requestId || null;
    const remotePendingCancelledLocally = this.isInjectRequestCancelled(remotePendingRequestId);
    const remotePendingCancelledRemotely =
        !!remotePendingRequestId &&
        remoteCancelledInfo?.requestId === remotePendingRequestId;
    const remotePendingCancelled = remotePendingCancelledLocally || remotePendingCancelledRemotely;
    let changed = false;

    Object.keys(optimisticSlots).forEach((slotKey) => {
        const slot = optimisticSlots[slotKey];
        const jan = slot?._meta?.jan;
        if (!jan) return;
        const status = slot?._meta?.status || 'pending';

        const remoteSkus = remoteSlots[slotKey]?.skus || (remoteSlots[slotKey]?.sku ? [remoteSlots[slotKey].sku] : []);
        const hasRemoteCommit = remoteSkus.includes(jan);
        const effectiveRemotePending = remotePendingCancelled ? null : remoteUserPending;
        const isPendingClearedForThisJan = !effectiveRemotePending || effectiveRemotePending.jan !== jan;
        const remoteConfirmed = hasRemoteCommit && isPendingClearedForThisJan;

        const committedAt = slot?._meta?.committedAt || 0;
        const createdAt = slot?._meta?.createdAt || 0;
        const now = Date.now();
        const committedTtlExpired = status === 'committed' && committedAt > 0 && (now - committedAt > 12000);
        const pendingTtlExpired = status === 'pending' && createdAt > 0 && (now - createdAt > 25000);

        if (remoteConfirmed || committedTtlExpired || pendingTtlExpired) {
            delete optimisticSlots[slotKey];
            changed = true;
        }
    });

    const localPending = this.localUiState.injectPendingPreview;
    if (localPending) {
        const remotePending = remotePendingCancelled
            ? null
            : (remoteState?.userStates?.[this.currentUserId]?.injectPending || null);
        const localJan = localPending.jan;
        const localRequestId = localPending.requestId || null;

        const sameRemotePending =
            remotePending &&
            remotePending.jan === localJan &&
            (!localRequestId || remotePending.requestId === localRequestId);

        const janExistsSomewhere = Object.values(remoteSlots).some((slot) => {
            const skus = slot?.skus || (slot?.sku ? [slot.sku] : []);
            return skus.includes(localJan);
        });

        if (!sameRemotePending && janExistsSomewhere) {
            this.localUiState.injectPendingPreview = null;
            changed = true;
        }

        if (remotePendingCancelled && (!localRequestId || localRequestId === remotePendingRequestId)) {
            this.localUiState.injectPendingPreview = null;
            changed = true;
        }
    } else if (remotePendingCancelled) {
        changed = true;
    }

    // NOTE:
    // Remote injectPendingCancelled cleanup (nulling stale values in Firestore) is intentionally
    // deferred to keep this patch minimal and avoid extra write chatter from reconcile loops.

    const cancelledMap = this.localUiState.cancelledInjectRequestIds || {};
    Object.keys(cancelledMap).forEach((reqId) => {
        const info = cancelledMap[reqId] || {};
        const cancelledAt = info.cancelledAt || 0;
        const jan = info.jan || null;
        const stillPendingRemotely = remotePendingRequestId === reqId;
        const janExistsSomewhere = jan && Object.values(remoteSlots).some((slot) => {
            const skus = slot?.skus || (slot?.sku ? [slot.sku] : []);
            return skus.includes(jan);
        });
        const expired = Date.now() - cancelledAt > 15000;
        if (expired || !stillPendingRemotely || janExistsSomewhere) {
            delete cancelledMap[reqId];
            changed = true;
        }
    });

    if (changed) {
        this._notifyUiOnlyChange();
    }
};

StateManager.prototype._getStateDocRef = function (uid) {
    const resolvedUid = uid || this.user?.uid;
    return this.db.collection("users").doc(resolvedUid).collection("states").doc("current");
};

StateManager.prototype._getStateDocPath = function (uid) {
    const resolvedUid = uid || this.user?.uid || 'unknown';
    return `users/${resolvedUid}/states/current`;
};

StateManager.prototype._logFirestoreError = function (action, error, uid) {
    console.error(`[firestore:${action}] failed`, {
        uid: uid || this.user?.uid,
        currentUserId: this.currentUserId,
        path: this._getStateDocPath(uid),
        code: error?.code,
        message: error?.message,
        error
    });
};

StateManager.prototype.subscribeToState = function (uid) {
    if (this.unsubscribeState) this.unsubscribeState();

    const docRef = this._getStateDocRef(uid);

    this.unsubscribeState = docRef.onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            // Migrate old state if needed
            if (!data.userStates) {
                this.migrateToMultiUser(uid, data);
            } else {
                this.state = data;
                this._reconcileLocalUiStateWithRemote(data);
                if (this.onStateChange) this.onStateChange(this.state);
            }
        } else {
            this.initializeNewSession(uid);
        }
    }, (error) => {
        this._logFirestoreError('subscribeToState', error, uid);
    });
};

StateManager.prototype.migrateToMultiUser = function (uid, oldData) {
    const userStates = {
        user1: {
            activePick: oldData.activePick || {},
            currentPickingNo: oldData.currentPickingNo || null,
            injectPending: oldData.injectPending || null
        },
        user2: { activePick: {}, currentPickingNo: null, injectPending: null },
        user3: { activePick: {}, currentPickingNo: null, injectPending: null },
        user4: { activePick: {}, currentPickingNo: null, injectPending: null }
    };
    
    const updates = {
        userStates: userStates,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // Clean up old root fields
    updates.activePick = firebase.firestore.FieldValue.delete();
    updates.currentPickingNo = firebase.firestore.FieldValue.delete();
    updates.injectPending = firebase.firestore.FieldValue.delete();

    return this._getStateDocRef(uid).update(updates).catch((error) => {
        this._logFirestoreError('migrateToMultiUser', error, uid);
        throw error;
    });
};

StateManager.prototype.initializeNewSession = function (uid) {
    const defaultConfig = {
        bays: null,
        maxSplit: 6,
        viewMode: 'multi',
        orientation: 'landscape',
        multiRows: 3,
        multiCols: 3,
        showOthers: false
    };

    const sourceConfig = this.state?.config || {};
    const { multiStartId: _legacyMultiStartId, ...sourceConfigWithoutLegacy } = sourceConfig;
    const config = {
        ...defaultConfig,
        ...sourceConfigWithoutLegacy
    };

    const totalBays = config.bays || 0;
    const splits = {};
    for (let b = 1; b <= totalBays; b++) {
        splits[b] = this.state?.splits?.[b] || 1;
    }

    const initialState = {
        mode: 'INJECT',
        config,
        slots: {},
        splits,
        injectList: {},
        pickLists: {},
        userStates: {
            user1: { activePick: {}, currentPickingNo: null, injectPending: null },
            user2: { activePick: {}, currentPickingNo: null, injectPending: null },
            user3: { activePick: {}, currentPickingNo: null, injectPending: null },
            user4: { activePick: {}, currentPickingNo: null, injectPending: null }
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return this._getStateDocRef(uid).set(initialState).catch((error) => {
        this._logFirestoreError('initializeNewSession', error, uid);
        throw error;
    });
};

StateManager.prototype.update = function (updates) {
    if (!this.user) return Promise.reject("Not authenticated");
    const uid = this.user.uid;
    const docRef = this._getStateDocRef(uid);
    return docRef.set({
        ...updates,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch((error) => {
        this._logFirestoreError('update', error, uid);
        throw error;
    });
};

StateManager.prototype._hasActiveSkuInSlot = function (slotData) {
    return !!slotData && (
        (Array.isArray(slotData.skus) && slotData.skus.length > 0) ||
        !!slotData.sku
    );
};

StateManager.prototype.applyBulkSplitCount = function (targetSplit) {
    if (!this.user || !this.state) return Promise.reject("Not authenticated");
    const uid = this.user.uid;

    const normalizedTarget = Math.max(1, Math.min(6, parseInt(targetSplit, 10) || 1));

    return this.db.runTransaction(async (transaction) => {
        const docRef = this._getStateDocRef(uid);
        const doc = await transaction.get(docRef);
        if (!doc.exists) return { changedBays: 0, constrainedBays: 0, targetSplit: normalizedTarget };

        const data = doc.data() || {};
        const totalBays = parseInt(data.config?.bays, 10) || 0;
        const splits = data.splits || {};
        const slots = data.slots || {};
        const updates = {
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        let changedBays = 0;
        let constrainedBays = 0;

        for (let bay = 1; bay <= totalBays; bay++) {
            const originalSplit = parseInt(splits[bay], 10) || 1;
            let nextSplit = originalSplit;

            if (nextSplit < normalizedTarget) {
                nextSplit = normalizedTarget;
            } else if (nextSplit > normalizedTarget) {
                let constrained = false;
                while (nextSplit > normalizedTarget) {
                    const lastSlotKey = `${bay}-${nextSplit}`;
                    if (this._hasActiveSkuInSlot(slots[lastSlotKey])) {
                        constrained = true;
                        break;
                    }
                    nextSplit -= 1;
                }
                if (constrained) constrainedBays += 1;
            }

            if (originalSplit !== nextSplit) {
                updates[`splits.${bay}`] = nextSplit;
                changedBays += 1;
            }
        }

        transaction.update(docRef, updates);
        return { changedBays, constrainedBays, targetSplit: normalizedTarget };
    }).catch((error) => {
        this._logFirestoreError('applyBulkSplitCount', error, uid);
        throw error;
    });
};

StateManager.prototype._applyResetLogic = function (userId, data, updates) {
    const userState = data.userStates?.[userId];
    if (!userState) return;

    const oldListId = userState.currentPickingNo;
    if (oldListId && data.pickLists?.[oldListId]) {
        const lines = data.pickLists[oldListId];
        const allDone = lines.length > 0 && lines.every(l => l.status === 'DONE');
        if (!allDone) {
            updates[`pickLists.${oldListId}`] = lines.map(l => ({ ...l, status: 'PENDING' }));
        }
    }
    updates[`userStates.${userId}.currentPickingNo`] = null;
    updates[`userStates.${userId}.activePick`] = {};
};

StateManager.prototype.resetUserPick = function (userId) {
    if (!this.user || !this.state) return Promise.reject("Not authenticated");
    const uid = this.user.uid;
    return this.db.runTransaction(async (transaction) => {
        const docRef = this._getStateDocRef(uid);
        const doc = await transaction.get(docRef);
        if (!doc.exists) return;
        const data = doc.data();
        const updates = { 
            mode: 'INJECT',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
        };
        this._applyResetLogic(userId, data, updates);
        transaction.update(docRef, updates);
    }).catch((error) => {
        this._logFirestoreError('resetUserPick', error, uid);
        throw error;
    });
};

StateManager.prototype.cancelAllPicks = function (extraUpdates = {}) {
    if (!this.user || !this.state) return Promise.reject("Not authenticated");
    const uid = this.user.uid;
    return this.db.runTransaction(async (transaction) => {
        const docRef = this._getStateDocRef(uid);
        const doc = await transaction.get(docRef);
        if (!doc.exists) return;
        const data = doc.data();
        const updates = { 
            mode: 'INJECT',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            ...extraUpdates
        };
        Object.keys(data.userStates || {}).forEach(uId => {
            this._applyResetLogic(uId, data, updates);
        });
        transaction.update(docRef, updates);
    }).catch((error) => {
        this._logFirestoreError('cancelAllPicks', error, uid);
        throw error;
    });
};

StateManager.prototype.saveInjectPendingSafely = function (pending) {
    if (!this.user || !this.state) return Promise.reject("Not authenticated");
    if (!pending || !pending.requestId) return Promise.reject("Invalid pending");

    const uid = this.user.uid;
    const requestId = pending.requestId;
    const requestedAt = pending.requestedAt || Date.now();

    if (this.isInjectRequestCancelled(requestId)) {
        return Promise.resolve({ skipped: true, reason: 'cancelled-before-start' });
    }

    return this.db.runTransaction(async (transaction) => {
        const docRef = this._getStateDocRef(uid);
        const doc = await transaction.get(docRef);
        if (!doc.exists) return { skipped: true, reason: 'missing-doc' };

        if (this.isInjectRequestCancelled(requestId)) {
            return { skipped: true, reason: 'cancelled-during-transaction' };
        }

        const data = doc.data() || {};
        const userStates = data.userStates || {};
        const currentUserState = userStates[this.currentUserId] || {};
        const remotePending = currentUserState.injectPending || null;
        const remoteCancelled = currentUserState.injectPendingCancelled || null;
        const remoteCancelledRequestId = remoteCancelled?.requestId || null;
        const remoteCancelledAt = remoteCancelled?.cancelledAt || 0;

        const isSameRequestCancelled =
            remoteCancelledRequestId &&
            remoteCancelledRequestId === requestId;

        const isCancelledAfterRequest =
            remoteCancelledAt > 0 &&
            remoteCancelledAt >= requestedAt;

        if (isSameRequestCancelled || isCancelledAfterRequest) {
            return { skipped: true, reason: 'remote-cancelled' };
        }

        if (remotePending) {
            const remoteRequestId = remotePending.requestId || null;
            const remoteRequestedAt = remotePending.requestedAt || 0;
            const isDifferentRequest = remoteRequestId && remoteRequestId !== requestId;
            const isRemoteNewer = remoteRequestedAt > requestedAt;
            if (isDifferentRequest && isRemoteNewer) {
                return { skipped: true, reason: 'newer-remote-pending-exists' };
            }
        } else if (this.isInjectRequestCancelled(requestId)) {
            return { skipped: true, reason: 'cancelled-with-remote-null' };
        }

        const updates = {
            mode: 'INJECT',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        Object.keys(userStates).forEach((uId) => {
            this._applyResetLogic(uId, data, updates);
        });

        if (this.isInjectRequestCancelled(requestId)) {
            return { skipped: true, reason: 'cancelled-before-update' };
        }

        if (isSameRequestCancelled || isCancelledAfterRequest) {
            return { skipped: true, reason: 'remote-cancelled-before-update' };
        }

        updates[`userStates.${this.currentUserId}.injectPending`] = { ...pending };
        updates[`userStates.${this.currentUserId}.injectPendingCancelled`] = null;
        transaction.update(docRef, updates);
        return { skipped: false };
    }).catch((error) => {
        this._logFirestoreError('saveInjectPendingSafely', error, uid);
        throw error;
    });
};

// Start picking a list (implements precedence rule and reset rule)
StateManager.prototype.startPicking = function (listId, activePickData) {
    if (!this.user || !this.state) return;
    const uid = this.user.uid;

    return this.db.runTransaction(async (transaction) => {
        const docRef = this._getStateDocRef(uid);
        const doc = await transaction.get(docRef);
        if (!doc.exists) return;
        const data = doc.data();
        const userStates = data.userStates || {};
        
        const updates = {
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Reset previous list for THIS user if it was different and incomplete
        const currentUserState = userStates[this.currentUserId];
        if (currentUserState && currentUserState.currentPickingNo !== listId) {
            this._applyResetLogic(this.currentUserId, data, updates);
        }

        // Precedence Rule: If anyone else is picking THIS new list, remove it from them
        Object.keys(userStates).forEach(uId => {
            if (uId !== this.currentUserId && userStates[uId].currentPickingNo === listId) {
                updates[`userStates.${uId}.currentPickingNo`] = null;
                updates[`userStates.${uId}.activePick`] = {};
            }
        });

        // Assign to current user
        updates[`userStates.${this.currentUserId}.currentPickingNo`] = listId;
        updates[`userStates.${this.currentUserId}.activePick`] = activePickData;
        updates.mode = 'PICK';

        transaction.update(docRef, updates);
    }).catch((error) => {
        this._logFirestoreError('startPicking', error, uid);
        throw error;
    });
};

StateManager.prototype.resetPreserveConfig = function () {
    if (!this.user) return Promise.reject("Not authenticated");

    const current = this.state || {};
    const currentConfig = current.config || {};
    const totalBays = currentConfig.bays || 9;

    const splits = {};
    for (let b = 1; b <= totalBays; b++) {
        splits[b] = 1;
    }

    const nextState = {
        mode: 'INJECT',
        config: {
            bays: totalBays,
            maxSplit: currentConfig.maxSplit || 6,
            viewMode: currentConfig.viewMode || 'multi',
            orientation: currentConfig.orientation || 'landscape',
            multiRows: currentConfig.multiRows || 3,
            multiCols: currentConfig.multiCols || 3,
            showOthers: !!currentConfig.showOthers,
            csvFormat: currentConfig.csvFormat || undefined
        },
        slots: {},
        splits,
        injectList: {},
        pickLists: {},
        userStates: {
            user1: { activePick: {}, currentPickingNo: null, injectPending: null },
            user2: { activePick: {}, currentPickingNo: null, injectPending: null },
            user3: { activePick: {}, currentPickingNo: null, injectPending: null },
            user4: { activePick: {}, currentPickingNo: null, injectPending: null }
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (nextState.config.csvFormat === undefined) {
        delete nextState.config.csvFormat;
    }

    const uid = this.user.uid;
    return this._getStateDocRef(uid).set(nextState).catch((error) => {
        this._logFirestoreError('resetPreserveConfig', error, uid);
        throw error;
    });
};

StateManager.prototype.reset = function () {
    if (!this.user) return Promise.reject("Not authenticated");
    return this.initializeNewSession(this.user.uid);
};

// Login/Logout methods
StateManager.prototype.login = function (email, password) {
    return this.auth.signInWithEmailAndPassword(email, password);
};

StateManager.prototype.signup = function (email, password) {
    return this.auth.createUserWithEmailAndPassword(email, password);
};

StateManager.prototype.logout = function () {
    return this.auth.signOut();
};

StateManager.prototype.selectSlot = function (bayId, subId) {
    const currentUserState = this.state?.userStates?.[this.currentUserId];
    const pendingFromFirestore = currentUserState?.injectPending;
    const pendingFromLocal = this.localUiState.injectPendingPreview;
    const pending = pendingFromFirestore || pendingFromLocal;
    if (!pending || pending.status !== "WAITING_SLOT") return;
    if (!this.user) return;

    const slotKey = `${bayId}-${subId}`;
    const pendingJan = pending.jan;
    const pendingRequestId = pending.requestId || null;
    const uid = this.user.uid;
    const docRef = this._getStateDocRef(uid);

    const opId = this.setOptimisticSlot(slotKey, pendingJan);
    this.clearLocalInjectPending();

    const isUnsyncedPendingError = (error) => {
        return error && error.message === 'injectPending is not synced to Firestore yet';
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const attemptSelectSlot = async (retryCount) => {
        try {
            await this.db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);
                if (!doc.exists) return;
                const data = doc.data();
                const userState = data.userStates[this.currentUserId];
                const remotePending = userState?.injectPending;

                const isSameJan = remotePending?.jan === pendingJan;
                const isSameRequestId = !pendingRequestId || remotePending?.requestId === pendingRequestId;
                if (!remotePending || !isSameJan || !isSameRequestId) {
                    throw new Error('injectPending is not synced to Firestore yet');
                }

                const slots = data.slots || {};
                const currentSlot = slots[slotKey] || {};

                let skus = currentSlot.skus || (currentSlot.sku ? [currentSlot.sku] : []);

                if (!skus.includes(pendingJan)) {
                    skus.push(pendingJan);
                }

                slots[slotKey] = { skus: skus };

                transaction.update(docRef, {
                    slots: slots,
                    [`userStates.${this.currentUserId}.injectPending`]: null,
                    [`userStates.${this.currentUserId}.injectPendingCancelled`]: null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
        } catch (error) {
            if (isUnsyncedPendingError(error) && retryCount > 0) {
                await sleep(200);
                return attemptSelectSlot(retryCount - 1);
            }
            throw error;
        }
    };

    return attemptSelectSlot(5).then(() => {
        this.markOptimisticSlotCommitted(slotKey, opId);
    }).catch((error) => {
        this.rollbackOptimisticInject(opId);
        const wasCancelled =
            pendingRequestId &&
            this.localUiState.cancelledInjectRequestIds &&
            this.localUiState.cancelledInjectRequestIds[pendingRequestId];
        if (!wasCancelled) {
            this.setLocalInjectPending({
                jan: pendingJan,
                status: 'WAITING_SLOT',
                requestedAt: pending.requestedAt,
                requestId: pendingRequestId
            });
        }
        this._logFirestoreError('selectSlot', error, uid);
        throw error;
    });
};

StateManager.prototype.unassignSlot = function (slotKey, targetJan) {
    if (!this.user || !this.state) return Promise.reject("Not authenticated");
    const uid = this.user.uid;
    return this.db.runTransaction(async (transaction) => {
        const docRef = this._getStateDocRef(uid);
        const doc = await transaction.get(docRef);
        if (!doc.exists) return;
        const data = doc.data();
        
        if (data.slots && data.slots[slotKey]) {
            const newSlots = { ...data.slots };
            const currentSlot = newSlots[slotKey];
            let skus = currentSlot.skus || (currentSlot.sku ? [currentSlot.sku] : []);
            
            if (targetJan) {
                skus = skus.filter(s => s !== targetJan);
            } else {
                skus = [];
            }
            
            if (skus.length === 0) {
                delete newSlots[slotKey];
            } else {
                newSlots[slotKey] = { skus: skus };
            }
            
            transaction.update(docRef, { slots: newSlots, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
    }).catch((error) => {
        this._logFirestoreError('unassignSlot', error, uid);
        throw error;
    });
};

StateManager.prototype.resetBay = function (bayId) {
    if (!this.user || !this.state) return Promise.reject("Not authenticated");
    const uid = this.user.uid;
    return this.db.runTransaction(async (transaction) => {
        const docRef = this._getStateDocRef(uid);
        const doc = await transaction.get(docRef);
        if (!doc.exists) return;
        const data = doc.data();
        
        const updates = { 
            [`splits.${bayId}`]: 1,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        if (data.slots) {
            const newSlots = { ...data.slots };
            let changed = false;
            Object.keys(newSlots).forEach(k => {
                if (k.startsWith(`${bayId}-`)) {
                    delete newSlots[k];
                    changed = true;
                }
            });
            if (changed) updates.slots = newSlots;
        }
        
        transaction.update(docRef, updates);
    }).catch((error) => {
        this._logFirestoreError('resetBay', error, uid);
        throw error;
    });
};
