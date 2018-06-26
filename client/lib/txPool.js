'use strict';

import Block from 'lib/model/block';
import config from "config";
import ethUtil from 'ethereumjs-util'; 
import { logger } from 'lib/logger';
import { getUTXO } from 'lib/tx';
import redis from 'lib/redis';
import { PlasmaTransaction } from 'lib/model/tx';

class TXPool {
  constructor () {
    this.newBlockNumber;
    this.newBlockNumberBuffer;
    this.inputKeys = {};
  }

  async length() {
    return await redis.llenAsync('txs');
  }

  async addTransaction(tx) {    
    if (!(await this.checkTransaction(tx)))
      return false;
    
    redis.rpushAsync('txs', tx.getRlp(false));
    return tx;
  }

  async checkTransaction(transaction) {
    try {
      if (transaction.prev_block == 0) {
        let address = ethUtil.addHexPrefix(transaction.getAddressFromSignature('hex').toLowerCase());    
        let valid = address == config.plasmaOperatorAddress.toLowerCase();

        if (!valid) 
          return false;
        
      } else {
        let utxo = await getUTXO(transaction.prev_block, transaction.token_id);
        if (!utxo) 
          return false;
        
        transaction.prev_hash = utxo.getHash();
        let address = ethUtil.addHexPrefix(transaction.getAddressFromSignature('hex').toLowerCase());    
        let utxoOwnerAddress = ethUtil.addHexPrefix(utxo.new_owner.toString('hex').toLowerCase());

        if (utxoOwnerAddress != address) 
          return false;

      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async getLastBlockNumberFromDb() {
    let lastBlock = await redis.getAsync('lastBlockNumber');

    if (!lastBlock) {
        redis.setAsync('lastBlockNumber', 0);
        lastBlock = 0;
    } else {
      lastBlock = parseInt(lastBlock);
    }

    this.newBlockNumber = lastBlock + config.contractblockStep;
  }

  async createNewBlock() {
    try {
      if (!this.newBlockNumber) 
        await this.getLastBlockNumberFromDb();
      
      let txCount = await this.length();
      
      let transactions = await redis.lrangeAsync(new Buffer('txs'), 0, txCount);
      transactions = transactions.map(function(el) {
        return new PlasmaTransaction(el);
      })
      
      if (txCount == 0) 
        return false;
      
      const blockData = {
        blockNumber: this.newBlockNumber,
        transactions: transactions
      };

      const block = new Block(blockData);

      for (let tx of block.transactions) {
        let utxo = tx;

        let utxoRlp = utxo.getRlp();
        let utxoNewKey = "utxo_" + block.blockNumber.toString(10) + "_"+ tx.token_id.toString(); 
        let utxoOldKey;
        let pblk = tx.prev_block;
        if (pblk instanceof Buffer) 
          pblk = pblk.readUIntBE();
        
        if (pblk) {
          utxoOldKey = "utxo_"+ tx.prev_block.toString(10) + "_"+ tx.token_id.toString();

          await redis.delAsync( utxoOldKey );
        }
        await redis.setAsync( utxoNewKey, utxoRlp );
      }
      await redis.setAsync( 'lastBlockNumber', block.blockNumber );
      await redis.setAsync( 'block' + block.blockNumber.toString(16) , block.getRlp() );
      
      for (let i=0; i<txCount; i++) 
        await redis.lsetAsync('txs' , i, 'DELETED');
      
      await redis.lremAsync('txs', 0, 'DELETED');
      
      logger.info('New block created - transactions: ', block.transactions.length);

      this.newBlockNumber = this.newBlockNumber + config.contractblockStep;
    
      return block;
    }
    catch(err){
      logger.error('createNewBlock error ', err);
    }
  }
};

const txPool = new TXPool();

export default txPool;