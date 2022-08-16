import BigInt from "big-integer";
import AliceNetWallet from 'alicenetjs';

class AliceNetAdapter {

    /**
     * @param {string} provider - AliceNet RPC Endpoint 
     */
    constructor(provider) {

        this.equalize = () => { };

        this.wallet = new AliceNetWallet();
        this.provider = provider;

        this.busy = false; // Doing something?
        this.error = false // Last error if any

        this.connected = false;
        this.MaxDataStoreSize = 2097152;
        this.BaseDatasizeConst = 376;

        // Accounts 
        this.balances = {};

        // Block explorer panel
        this.blockMonitorTimeout = () => { };
        this.blockMonitoringError = false;
        this.blocks = [];
        this.blocksLocked = false;
        this.blocksMaxLen = 10;
        this.blocksMonitoringEnabled = false;
        this.blocksRetry = 0;
        this.currentBlock = 0;

        // Tx explorer panel
        this.transactionRetry = 0;
        this.transactionHash = false;
        this.transaction = false;
        this.transactionHeight = false;

        // DataStore explorer panel
        this.dsRetry = 0;
        this.dsRedirected = false;
        this.dsSearchOpts = { "address": "", "offset": "", "bnCurve": false };
        this.dsDataStores = [];
        this.dsActivePage = 1;
        this.dsView = [];
        this.DataPerPage = 5;
        this.dsLock = false;
    }

    /** 
    /* @param {function} stateEqualizer - If using a state management system (like redux) this function should be a callback or similar function to signal state changes should be polled from this class
    */
    async setEqualizerFunction(stateEqualizer = () => { }) {
        this.equalize = stateEqualizer;
    }

    /**
     *Initialize the adapter by trying to connect to the RPC endpoint
     @returns {Boolean|Object} - True if OK or {error.msg}
     */
    async init() {
        console.log("INITLOCAL");
        try {
            this.busy = "Connecting";
            this.equalize();
            await this.wallet.Rpc.setProvider(this.provider)
            this.connected = true;
            this.busy = false;
            this.equalize();
            return true;
        }
        catch (ex) {
            console.log(ex)
            this.error = ex.message;
            return this._err(ex.message);
        }
    }

    clearError() {
        this.error = false;
        this.equalize();
    }

    _err(msg) {
        return { error: msg };
    }

    /**
     * Try a function call and return error object while logging issues to console
     * @param {*} methodToTry 
     * @param {*} methodParams
     * @param {*} errorPrefix 
     */
    async _trySubMethod(errorPrefix, methodToTry) {
        try {
            if (methodToTry.constructor.name === "AsyncFunction") {
                return await methodToTry();
            } else {
                return methodToTry();
            }
        } catch (ex) {
            let errMsg = errorPrefix + " -- " + ex.message;
            console.error(errMsg);
            return this._err(errMsg);
        }
    }

    /**
     * Returns Alice Net wallet balance and utxoids for respective address and curve
     * @param address - Wallet address to look up the balance for
     * @param curve - Address curve to use
     */
     async getBalanceAndUTXOs(address, curve = 1) {
        if (!address) { return this._err("Missing required 'address' parameter") };
        let [utxoids, balance] = await this._trySubMethod("alicenetjs-adapter.getBalanceAndUTXOs: ", async () => this.wallet.Rpc.getValueStoreUTXOIDs(address, curve));
        balance = String(parseInt(balance, 16));
        return [balance, utxoids];
    }

    /**
     * Updates Alice Net wallet balance and utxoids for respective address and curve
     * @param address - Wallet address to look up the balance for
     * @param curve - Address curve to use
     */
    async updateBalanceForAddress(address, curve = 1) {
        let [balance] = await this.getBalanceAndUTXOs(address, curve);
        this.balances = { ...this.balances, [address]: balance };       
        this.equalize();    
    }

    /** Begin monitoring blocks -- Will update this.blocks every 5 seconds */
    startMonitoringBlocks() {
        if (!this.blocksMonitoringEnabled) {
            this.blocksMonitoringEnabled = true;
            this._monitorBlocks();
            this.blockMonitorTimeout = setInterval(() => { this._monitorBlocks() }, 5000);
        } else {
            return this._err("Already started");
        }
    }

    /** Stop monitoring blocks */
    stopMonitoringBlocks() {
        if (!this.blocksMonitoringEnabled) {
            return this._err("Not currently monitoring blocks")
        }
        clearTimeout(this.blockMonitorTimeout);
        this.blocks = [];
        this.blocksMonitoringEnabled = false;
        this.currentBlock = 0;
        this.blocksLocked = false;
        this.equalize();
    }

    resetBlockMonitor() {
        this.stopMonitoringBlocks();
        this.startMonitoringBlocks();
    }

    // Monitor new blocks, lazy loading
    async _monitorBlocks() {
        if (!this.blocksMonitoringEnabled) {
            this.startMonitoringBlocks();
        }
        try {
            if (this.blocksLocked) { return; }
            this.blocksLocked = true;
            this.equalize();
            try {
                let tmpBlocks = this.blocks ? [...this.blocks] : [];
                let currentBlock = await this.wallet.Rpc.getBlockNumber();
                if (this.currentBlock !== currentBlock) {
                    let blockDiff = (currentBlock - this.currentBlock);
                    if (blockDiff > this.blocksMaxLen) {
                        blockDiff = this.blocksMaxLen;
                    }
                    for (let i = 0; i < blockDiff; i++) {
                        let blockHeader = await this.wallet.Rpc.getBlockHeader(currentBlock - ((blockDiff - i) - 1));
                        tmpBlocks.unshift(blockHeader);
                    }
                    this.currentBlock = currentBlock;
                    this.blocks = tmpBlocks;
                }
                tmpBlocks = tmpBlocks.slice(0, this.blocksMaxLen);
                this.blocks = tmpBlocks;
            }
            catch (ex) {
                console.error(ex);
            }
            this.blocksLocked = false
            this.equalize();
        }
        catch (ex) {
            this.blockMonitoringError = ex.message;
            this.equalize();
        }
    }

    async getBlock(height) {
        if (!height) { return this._err("Missing required 'height' parameter") }
        this.busy = "Getting Block By Number: " + height;
        this.equalize();
        let blockNumber = await this._trySubMethod("alicenetjs-adapter.getBlock: ", async () => this.wallet.Rpc.getBlockHeader(height));
        this.busy = false;
        this.equalize();
        return blockNumber;
    }

    async getCurrentBlock() {
        let currentBlockNumber = await this._trySubMethod("alicenetjs-adapter.getCurrentBlock: ", async () => this.getCurrentBlockNumber());
        let currentBlock = await this._trySubMethod("alicenetjs-adapter.getCurrentBlock: ", async () => this.getBlock(currentBlockNumber));
        return currentBlock;
    }

    async getCurrentBlockNumber() {
        let currentBlockNumber = await this._trySubMethod("alicenetjs-adapter.getCurrentBlockNumber: ", async () => this.wallet.Rpc.getBlockNumber());
        return currentBlockNumber;
    }

    /**
     * View block that contains a given txHash
     * @param {*} txHash 
     * @returns 
     */
    async viewBlockFromTxHash(txHash) {
        this.busy = "Getting Block";
        this.equalize();
        let txHeight = await this._trySubMethod("alicenetjs-adapter.viewBlockFromTxHash", async () => this.wallet.Rpc.getTxBlockHeight(txHash));
        this.transactionHeight = txHeight;
        let blockHeader = await this._trySubMethod("alicenetjs-adapter.viewBlockFromTxHash", async () => this.wallet.Rpc.getBlockHeader(txHeight));
        this.blockInfo = blockHeader;
        this.busy = false;
        this.equalize();
        return blockHeader;
    }

    // Get transaction for txExplorer
    async viewTransaction(txHash) {
        this.busy = "Getting Transaction";
        this.transactionHash = txHash;
        this.equalize();
        if (txHash.indexOf('0x') >= 0) {
            txHash = txHash.slice(2);
        }
        let Tx = await this._trySubMethod("alicenetjs-adapter.viewTransaction", async () => this.wallet.Rpc.getMinedTransaction(txHash));
        this.transaction = Tx["Tx"];
        let txHeight = await this._trySubMethod("alicenetjs-adapter.viewTransaction", async () => this.wallet.Rpc.getTxBlockHeight(txHash));
        this.transactionHeight = txHeight;
        this.busy = false;
        this.equalize();
        return [this.transaction, this.transactionHeight];
    }

    getDSExp(data, deposit, issuedAt) {
        try {
            let dataSize = Buffer.from(data, "hex").length;
            if (BigInt(dataSize) > BigInt(this.MaxDataStoreSize)) {
                throw "Data size is too large"
            }
            let epoch = BigInt("0x" + deposit) / BigInt((BigInt(dataSize) + BigInt(this.BaseDatasizeConst)))
            if (BigInt(epoch) < BigInt(2)) {
                throw "invalid dataSize and deposit causing integer overflow"
            }
            let numEpochs = BigInt(BigInt(epoch) - BigInt(2));
            let expEpoch = (BigInt(issuedAt) + BigInt(numEpochs));
            return expEpoch;
        }
        catch (ex) {
            return false;
        }
    }

    /** -- TODO: Add pagination functions??
     * Get DataStores for an address
     * @param {*} address 
     * @param {*} curve 
     * @param {*} index 
     * @returns 
     */
    async getDataStoresForAddres(address = "eeacfc737e72fdf2518fb58c0a620f783eb2515f", curve = 1, index) {
        this.dsLock = true;
        this.busy = "Getting Datastores";
        this.equalize();
        let dataStoreUTXOIDs = await this._trySubMethod("alicenetjs-adapter.getDataStoresForAddress: ", async () => this.wallet.Rpc.getDataStoreUTXOIDs(address, curve, (this.DataPerPage + 1), index));
        console.log(dataStoreUTXOIDs)
        if (!dataStoreUTXOIDs) {
            this.dsLock = false;
            this.equalize();
            return [];
        }
        let DStores = await this._trySubMethod("alicenetjs", async () => this.wallet.Rpc.getUTXOsByIds(dataStoreUTXOIDs));
        this.dsLock = false;
        this.busy = false;
        this.equalize();
        return DStores;
    }

    // TODO MOVE TO UTILS --

    // Trim txHash for readability
    trimTxHash(txHash) {
        try {
            let trimmed = "0x" + txHash.substring(0, 6) + "..." + txHash.substring(txHash.length - 6)
            return trimmed
        }
        catch (ex) {
            throw String(ex)
        }
    }

    // Hex to integer
    hexToInt(hex) {
        try {
            let bInt = BigInt(hex, 16);
            return bInt.toString();
        }
        catch (ex) {

        }
    }

}

export default AliceNetAdapter;
