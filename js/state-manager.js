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
}

StateManager.prototype.subscribeToState = function (uid) {
    if (this.unsubscribeState) this.unsubscribeState();

    const docRef = this.db.collection("users").doc(uid).collection("states").doc("current");

    this.unsubscribeState = docRef.onSnapshot((doc) => {
        if (doc.exists) {
            this.state = doc.data();
            if (this.onStateChange) this.onStateChange(this.state);
        } else {
            this.initializeNewSession(uid);
        }
    }, (error) => {
        console.error("Firestore Error:", error);
    });
};

StateManager.prototype.initializeNewSession = function (uid) {
    const initialState = {
        mode: 'INJECT',
        config: { 
            bays: null, 
            maxSplit: 6,
            viewMode: 'multi',
            orientation: 'landscape',
            multiRows: 3,
            multiCols: 3,
            multiStartId: 1
        },
        slots: {},
        splits: {},
        injectList: {}, // Change to object for JAN: Quantity mapping
        pickLists: {},
        activePick: {},
        injectPending: null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    return this.db.collection("users").doc(uid).collection("states").doc("current").set(initialState);
};

StateManager.prototype.update = function (updates) {
    if (!this.user) return Promise.reject("Not authenticated");
    const docRef = this.db.collection("users").doc(this.user.uid).collection("states").doc("current");
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    return docRef.update(updates);
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
    if (!this.state?.injectPending || this.state.injectPending.status !== "WAITING_SLOT") return;
    if (!this.user) return;

    const slotKey = `${bayId}-${subId}`;
    const pendingJan = this.state.injectPending.jan;
    const docRef = this.db.collection("users").doc(this.user.uid).collection("states").doc("current");

    return this.db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) return;
        const data = doc.data();

        if (!data.injectPending || data.injectPending.jan !== pendingJan) return;

        const slots = data.slots || {};
        const currentSlot = slots[slotKey] || {};
        
        let skus = currentSlot.skus || (currentSlot.sku ? [currentSlot.sku] : []);
        
        if (!skus.includes(pendingJan)) {
            skus.push(pendingJan);
        }

        slots[slotKey] = { skus: skus };

        transaction.update(docRef, {
            slots: slots,
            injectPending: null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });
};

StateManager.prototype.unassignSlot = function (slotKey, targetJan) {
    if (!this.user || !this.state) return Promise.reject("Not authenticated");
    return this.db.runTransaction(async (transaction) => {
        const docRef = this.db.collection("users").doc(this.user.uid).collection("states").doc("current");
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
    });
};

StateManager.prototype.resetBay = function (bayId) {
    if (!this.user || !this.state) return Promise.reject("Not authenticated");
    return this.db.runTransaction(async (transaction) => {
        const docRef = this.db.collection("users").doc(this.user.uid).collection("states").doc("current");
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
    });
};
