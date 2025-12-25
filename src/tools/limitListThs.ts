import { TUSHARE_CONFIG } from '../config.js';
import { resolveStockCodes } from '../utils/stockCodeResolver.js';

export const limitListThs = {
  name: 'limit_list_ths',
  description: '同花顺涨跌停榜单(limit_list_ths)。必填：交易日期；可选：交易所代码。返回当日涨跌停股票明细，包含涨停时间、封单量、开板次数等数据。',
  parameters: {
    type: 'object',
    properties: {
      trade_date: {
        type: 'string',
        description: '交易日期，格式YYYYMMDD'
      },
      exchange: {
        type: 'string',
        description: '可选，交易所代码，如上交所SSE、深交所SZSE'
      }
    },
    required: ['trade_date']
  },
  async run(args: { trade_date: string; exchange?: string }) {
    try {
      if (!args.trade_date || args.trade_date.trim().length !== 8) {
        throw new Error('trade_date 必须为YYYYMMDD');
      }

      if (!TUSHARE_CONFIG.API_TOKEN) {
        throw new Error('请配置TUSHARE_TOKEN环境变量');
      }

      const params: any = {
        api_name: 'limit_list_ths',
        token: TUSHARE_CONFIG.API_TOKEN,
        params: {
          trade_date: args.trade_date
        }
      };
      if (args.exchange) params.params.exchange = args.exchange;

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
              { type: 'text', text: `# 同花顺涨跌停榜单 ${args.trade_date}${args.exchange ? ` - ${args.exchange}` : ''}\n\n暂无数据` }
            ]
          };
        }

        // 字段说明
        const fieldMapping: Record<string, string> = {
          'ts_code': '股票代码',
          'trade_date': '交易日期',
          'name': '股票名称',
          'close': '收盘价',
          'pct_chg': '涨跌幅(%)',
          'open_num': '打开次数',
          'lu_desc': '涨停原因',
          'limit_type': '板单类别',
          'tag': '涨停标签',
          'status' : '涨停状态（N连板、一字板）',
          'amp_pct': '震幅(%)',
          'float_mv': '流通市值(万元)',
          'amount': '成交额(万元)',
          'limit_amount': '封单金额(万元)',
          'limit_amount_vol': '封单量(手)',
          'first_time': '首次涨停时间',
          'last_time': '最后封涨停时间',
          'first_ld_time': '首次跌停时间',
          'last_ld_time': '最后跌停时间',
          'open_times': '开板次数',
          'up_stat': '涨停统计',
          'limit_order': '涨停价',
          'order_amount': '委托额',
          'order_vol': '委托量(手)',
          'fd_amount': '封单金额(万元)',
          'float_share': '流通股本(万股)',
          'turnover_ratio': '换手率(%)'
        };

        // 构建表头
        const desiredFields = ['ts_code', 'name', 'close', 'pct_chg', 'amp_pct', 'lu_desc', 'limit_type', 'tag', 'status',
                               'first_time', 'last_time', 'open_times', 'first_ld_time', 'last_ld_time', 'up_stat',
                               'limit_amount_vol', 'limit_amount', 'fd_amount',
                               'amount', 'turnover_ratio', 'float_mv'];
        const headers = desiredFields.filter(f => fields.includes(f));

        let table = `| ${headers.map(h => fieldMapping[h] || h).join(' | ')} |\n`;
        table += `|${headers.map(() => '--------').join('|')}|\n`;

        let totalAmount = 0;
        let totalLimitAmount = 0;
        let totalFdAmount = 0;
        const stockCodes: string[] = [];
        let ztCount = 0; // 涨停数量
        let dtCount = 0; // 跌停数量

        for (const row of items) {
          const obj: Record<string, any> = {};
          fields.forEach((f: string, idx: number) => obj[f] = row[idx]);

          stockCodes.push(String(obj.ts_code || ''));

          // 统计涨停跌停数量
          const pctChg = Number(obj.pct_chg);
          if (!isNaN(pctChg)) {
            if (pctChg > 9.8) ztCount++;
            else if (pctChg < -9.8) dtCount++;
          }

          const line = headers.map(h => {
            const v = obj[h];
            if (v === null || v === undefined || v === '') return 'N/A';

            // 数值字段格式化
            if (['close', 'pct_chg', 'amp_pct', 'turnover_ratio'].includes(h)) {
              return Number(v).toFixed(2);
            }
            // 金额字段格式化
            if (['limit_amount', 'amount', 'fd_amount', 'float_mv'].includes(h)) {
              return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
            }
            // 数量字段格式化
            if (['limit_amount_vol', 'order_vol', 'float_share'].includes(h)) {
              return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
            }
            return String(v);
          });
          table += `| ${line.join(' | ')} |\n`;

          // 统计合计
          const amountVal = Number(obj.amount);
          const limitAmountVal = Number(obj.limit_amount);
          const fdAmountVal = Number(obj.fd_amount);
          if (!isNaN(amountVal)) totalAmount += amountVal;
          if (!isNaN(limitAmountVal)) totalLimitAmount += limitAmountVal;
          if (!isNaN(fdAmountVal)) totalFdAmount += fdAmountVal;
        }

        const title = `# 同花顺涨跌停榜单 ${args.trade_date}${args.exchange ? ` - ${args.exchange}` : ''}`;
        const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
        const summary = `\n\n## 📊 当日统计\n- 上榜股票: ${items.length} 只\n- 涨停数量: ${ztCount} 只\n- 跌停数量: ${dtCount} 只\n- 总成交额: ${fmt(totalAmount)} 万元\n- 封单金额合计: ${fmt(totalLimitAmount)} 万元\n- 封单金额(最新): ${fmt(totalFdAmount)} 万元`;

        // 股票代码说明
        const stockExplanation = await resolveStockCodes(stockCodes);

        // 添加字段说明
        const fieldNotes = `\n\n## 📝 字段说明\n- **首次涨停时间**: 当日第一次达到涨停价的时间\n- **最后封涨停时间**: 最后一次封住涨停的时间\n- **开板次数**: 涨停后被打开的次数\n- **封单量**: 涨停价上的挂单量(手)\n- **封单金额**: 涨停价上的挂单金额(万元)\n- **震幅**: (最高价-最低价)/昨收*100%`;

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
