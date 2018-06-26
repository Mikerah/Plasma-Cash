import config from '../config';
import redis from '../lib/redis';
import Block  from '../lib/model/block';

class BlockController {
  static async get(req, res) {
    try {
      let params = req.url.split('/');
      const blockNumber = parseInt(params[3]);
      if (!blockNumber) {
        res.statusCode = 400;
        return res.end("invalid block number");
      }
      const key = 'block' + blockNumber.toString(16);
      const blockRlp = await redis.getAsync(Buffer.from(key));
      const block = new Block(blockRlp);
      let resJson = block.getJson();
      return res.end(JSON.stringify(resJson));
    } catch(error) {
      res.statusCode = 400;
      res.end(error.toString());
    }
  }
}

export default BlockController;