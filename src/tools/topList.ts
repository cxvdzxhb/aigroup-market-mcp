import { TUSHARE_CONFIG } from '../config.js';
import { resolveStockCodes, extractStockCodes } from '../utils/stockCodeResolver.js';

export const topList = {
  name: 'top_list',
  description: '龙虎榜每日明细(top_list)。必填：交易日期；可选：股票TS代码。返回每日龙虎榜上榜股票明细，包含涨跌幅、换手率、龙虎榜成交额等数据。',
  parameters: {
    type: 'object',
    properties: {
      trade_date: {
        type: 'string',
        description: '交易日期，格式YYYYMMDD'
      },
      ts_code: {
        type: 'string',
        description: '可选，股票TS代码，如 000001.SZ'
      }
    },
    required: ['trade_date']
  },
  async run(args: { trade_date: string; ts_code?: string }) {
    try {
      if (!args.trade_date || args.trade_date.trim().length !== 8) {
        throw new Error('trade_date 必须为YYYYMMDD');
      }

      if (!TUSHARE_CONFIG.API_TOKEN) {
        throw new Error('请配置TUSHARE_TOKEN环境变量');
      }

      const params: any = {
        api_name: 'top_list',
        token: TUSHARE_CONFIG.API_TOKEN,
        params: {
          trade_date: args.trade_date
        }
      };
      if (args.ts_code) params.params.ts_code = args.ts_code;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TUSHARE_CONFIG.TIMEOUT);
      try {
        const resp = await fetch(TUSHARE_CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: controller.signal
        });
        if (!resp.ok) throw new Error(`Tushare API请求失败: ${resp.status}`);
        const data = await resp.json();
        if (data.code !== 0) throw new Error(`Tushare API错误: ${data.msg}`);

        const fields: string[] = data.data?.fields ?? [];
        const items: any[] = data.data?.items ?? [];
        if (items.length === 0) {
          return {
            content: [
              { type: 'text', text: `# 龙虎榜每日明细 ${args.trade_date}${args.ts_code ? ` - ${args.ts_code}` : ''}\n\n暂无数据` }
            ]
          };
        }

        // 字段说明（按Tushare top_list接口字段顺序）
        const fieldMapping: Record<string, string> = {
          'ts_code': '股票代码',
          'trade_date': '交易日期',
          'name': '股票名称',
          'close': '收盘价',
          'pct_chg': '涨跌幅(%)',
          'turnover_rate': '换手率(%)',
          'amount': '龙虎榜成交额(万元)',
          'l_sell': '龙虎榜卖出额(万元)',
          'l_buy': '龙虎榜买入额(万元)',
          'l_amount': '龙虎榜净买入额(万元)',
          'net_rate': '净买入率(%)',
          'amount_rate': '成交额占比(%)',
          'float_values': '流通市值(万元)',
          'reason': '上榜理由',
          'exalter': '上榜营业部名称'
        };

        // 构建表头（移除trade_date，已在标题中显示）
        const desiredFields = ['ts_code', 'name', 'close', 'pct_chg', 'turnover_rate',
                               'l_buy', 'l_sell', 'l_amount', 'net_rate', 'amount_rate',
                               'amount', 'float_values', 'exalter', 'reason'];
        const headers = desiredFields.filter(f => fields.includes(f));

        let table = `| ${headers.map(h => fieldMapping[h] || h).join(' | ')} |\n`;
        table += `|${headers.map(() => '--------').join('|')}|\n`;

        let totalLbuy = 0;
        let totalLsell = 0;
        let totalLamount = 0;
        let totalAmount = 0;
        const stockCodes: string[] = [];

        for (const row of items) {
          const obj: Record<string, any> = {};
          fields.forEach((f: string, idx: number) => obj[f] = row[idx]);

          stockCodes.push(String(obj.ts_code || ''));

          const line = headers.map(h => {
            const v = obj[h];
            if (v === null || v === undefined || v === '') return 'N/A';

            // 数值字段格式化
            if (['close', 'pct_chg', 'turnover_rate', 'net_rate', 'amount_rate'].includes(h)) {
              return Number(v).toFixed(2);
            }
            // 金额字段格式化（万元）
            if (['l_sell', 'l_buy', 'l_amount', 'amount', 'float_values'].includes(h)) {
              return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
            }
            return String(v);
          });
          table += `| ${line.join(' | ')} |\n`;

          // 统计合计
          const lbuyVal = Number(obj.l_buy);
          const lsellVal = Number(obj.l_sell);
          const lamountVal = Number(obj.l_amount);
          const amountVal = Number(obj.amount);
          if (!isNaN(lbuyVal)) totalLbuy += lbuyVal;
          if (!isNaN(lsellVal)) totalLsell += lsellVal;
          if (!isNaN(lamountVal)) totalLamount += lamountVal;
          if (!isNaN(amountVal)) totalAmount += amountVal;
        }

        const title = `# 龙虎榜每日明细 ${args.trade_date}${args.ts_code ? ` - ${args.ts_code}` : ''}`;
        const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
        const summary = `\n\n## 📊 当日统计\n- 上榜股票: ${items.length} 只\n- 龙虎榜买入额: ${fmt(totalLbuy)} 万元\n- 龙虎榜卖出额: ${fmt(totalLsell)} 万元\n- 净买入额: ${fmt(totalLamount)} 万元\n- 总成交额: ${fmt(totalAmount)} 万元`;

        // 股票代码说明
        const stockExplanation = await resolveStockCodes(stockCodes);

        // 添加字段说明
        const fieldNotes = `\n\n## 📝 字段说明\n- **涨跌幅**: 当日股价涨跌百分比\n- **换手率**: 成交量占流通股本的比例\n- **龙虎榜成交额**: 龙虎榜上的总成交金额(万元)\n- **净买入率**: (买入-卖出)/总成交额\n- **成交额占比**: 龙虎榜成交额占该股票当日总成交额的比例\n- **上榜理由**: 如"当日涨幅偏离值达7%"、"当日换手率达20%"等`;

        return {
          content: [
            { type: 'text', text: `${title}\n\n${table}${summary}${stockExplanation}${fieldNotes}` }
          ]
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `❌ 查询失败: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true
      };
    }
  }
};
