
var tokenContracts = {};


/**
Creates filters for a wallet contract, to watch for deposits, pending confirmations, or contract creation events.

@method setupContractFilters
@param {Object} newDocument
@param {Boolean} checkFromCreationBlock
*/
var setupContractFilters = function(newDocument){
    var contractInstance = tokenContracts['ct_'+ newDocument._id] = TokenContract.at(newDocument.address);

    if(!contractInstance)
        return;

    var blockToCheckBack = (newDocument.checkpointBlock || 0) - ethereumConfig.rollBackBy;

    // TODO change to 0, when new geth is out!!!!!
    if(blockToCheckBack < 400000)
        blockToCheckBack = 400000;

    if(!contractInstance.tokenEvents)
        contractInstance.tokenEvents = [];

    var events = contractInstance.tokenEvents;

    // delete old events
    _.each(Transactions.find({tokenId: newDocument._id, blockNumber: {$exists: true, $gt: blockToCheckBack}}).fetch(), function(tx){
        if(tx)
            Transactions.remove({_id: tx._id});
    });

    // SETUP FILTERS
    Helpers.eventLogs('Checking Token Transfers for '+ contractInstance.address +' (_id: '+ newDocument._id +') from block #', blockToCheckBack);



    var filter = contractInstance.allEvents({fromBlock: blockToCheckBack, toBlock: 'latest'});
    events.push(filter);

    // get past logs, to set the new blockNumber
    var currentBlock = EthBlocks.latest.number;
    filter.get(function(error, logs) {
        if(!error) {
            // update last checkpoint block
            Tokens.update({_id: newDocument._id}, {$set: {
                checkpointBlock: (currentBlock || EthBlocks.latest.number) - ethereumConfig.rollBackBy
            }});
        }
    });

    filter.watch(function(error, log){
        if(!error) {
            Helpers.eventLogs(log);

            if(EthBlocks.latest.number && log.blockNumber > EthBlocks.latest.number) {
                // update last checkpoint block
                Tokens.update({_id: newDocument._id}, {$set: {
                    checkpointBlock: log.blockNumber
                }});
            }

            if(log.event === 'Transfer' &&
               (Helpers.getAccountByAddress(log.args.receiver) || Helpers.getAccountByAddress(log.args.sender))) {
                
                Helpers.eventLogs('Transfer for '+ newDocument.address +' arrived in block: #'+ log.blockNumber, log.args.amount.toNumber());

                // add tokenID
                log.tokenId = newDocument._id;

                var txExists = addTransaction(log, log.args.sender, log.args.receiver, log.args.amount.toString(10));

                // NOTIFICATION
                if(!txExists) {
                    Helpers.showNotification('wallet.transactions.notifications.tokenTransfer', {
                        token: newDocument.name,
                        to: Helpers.getAccountNameByAddress(log.args.receiver),
                        from: Helpers.getAccountNameByAddress(log.args.sender),
                        amount: Helpers.formatNumberByDecimals(log.args.amount, newDocument.decimals)
                    });
                }
            }
        } else {
            console.error('Logs of Token '+ newDocument.name + ' couldn\'t be received', error);
        }
    });
};

/**
Observe tokens

@method observeTokens
*/
observeTokens = function(){

    /**
    Observe tokens, listen for new created tokens.

    @class Tokens({}).observe
    @constructor
    */
    collectionObservers[collectionObservers.length] = Tokens.find({}).observe({
        /**
        This will observe the transactions creation and create watchers for outgoing trandsactions, to see when they are mined.

        @method added
        */
        added: function(newDocument) {

            if(newDocument.address) {
                setupContractFilters(newDocument);
            }

        },
        /**
        Remove transactions confirmations from the accounts

        @method removed
        */
        removed: function(document) {
            var contractInstance = tokenContracts['ct_'+ newDocument._id];

            if(!contractInstance)
                return;

            // stop all running events
            _.each(contractInstance.tokenEvents, function(event){
                event.stopWatching();
                contractInstance.tokenEvents.shift();
            });
        }
    });

};