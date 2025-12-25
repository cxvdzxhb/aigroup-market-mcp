import { TUSHARE_CONFIG } from '../config.js';
import { resolveStockCodes } from '../utils/stockCodeResolver.js';

export const hmDetail = {
  name: 'hm_detail',
  description: '游资每日明细(hm_detail)。必填：交易日期；可选：营业部代码。返回游资营业部每日交易明细，包含买入/卖出股票、金额等数据。',
  parameters: {
    type: 'object',
    properties: {
      trade_date: {
        type: 'string',
        description: '交易日期，格式YYYYMMDD'
      },
      department: {
        type: 'string',
        description: '可选，营业部代码'
      }
    },
    required: ['trade_date']
  },
  async run(args: { trade_date: string; department?: string }) {
    try {
      if (!args.trade_date || args.trade_date.trim().length !== 8) {
        throw new Error('trade_date 必须为YYYYMMDD');
      }

      if (!TUSHARE_CONFIG.API_TOKEN) {
        throw new Error('请配置TUSHARE_TOKEN环境变量');
      }

      const params: any = {
        api_name: 'hm_detail',
        token: TUSHARE_CONFIG.API_TOKEN,
        params: {
          trade_date: args.trade_date
        }
      };
      if (args.department) params.params.department = args.department;

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
              { type: 'text', text: `# 游资每日明细 ${args.trade_date}${args.department ? ` - ${args.department}` : ''}\n\n暂无数据` }
            ]
          };
        }

        // 字段说明
        const fieldMapping: Record<string, string> = {
          'trade_date': '交易日期',
          'department': '营业部代码',
          'exalter': '营业部名称',
          'side': '买卖方向',
          'ts_code': '股票代码',
          'name': '股票名称',
          'amount': '成交金额(万元)',
          'rate': '占总成交比例(%)',
          'rank': '排名'
        };

        // 构建表头
        const desiredFields = ['department', 'exalter', 'ts_code', 'name',
                               'side', 'amount', 'rate', 'rank'];
        const headers = desiredFields.filter(f => fields.includes(f));

        let table = `| ${headers.map(h => fieldMapping[h] || h).join(' | ')} |\n`;
        table += `|${headers.map(() => '--------').join('|')}|\n`;

        let totalBuyAmount = 0;
        let totalSellAmount = 0;
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
            if (['rate'].includes(h)) {
              return Number(v).toFixed(2);
            }
            // 金额字段格式化
            if (['amount'].includes(h)) {
              return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
            }
            return String(v);
          });
          table += `| ${line.join(' | ')} |\n`;

          // 统计合计
          const amountVal = Number(obj.amount);
          const side = String(obj.side || '').trim();
          if (!isNaN(amountVal)) {
            totalAmount += amountVal;
            if (side === '买入' || side === '买') {
              totalBuyAmount += amountVal;
            } else if (side === '卖出' || side === '卖') {
              totalSellAmount += amountVal;
            }
          }
        }

        const title = `# 游资每日明细 ${args.trade_date}${args.department ? ` - ${args.department}` : ''}`;
        const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
        const summary = `\n\n## 📊 当日统计\n- 交易记录: ${items.length} 条\n- 买入总额: ${fmt(totalBuyAmount)} 万元\n- 卖出总额: ${fmt(totalSellAmount)} 万元\n- 总成交额: ${fmt(totalAmount)} 万元\n- 净买入: ${fmt(totalBuyAmount - totalSellAmount)} 万元`;

        // 股票代码说明
        const stockExplanation = await resolveStockCodes(stockCodes);

        // 添加字段说明
        const fieldNotes = `\n\n## 📝 字段说明\n- **买卖方向**: 买入或卖出\n- **成交金额**: 该营业部在该股票上的成交金额(万元)\n- **占总成交比例**: 该营业部成交额占该股票总成交额的比例\n- **排名**: 该营业部在该股票龙虎榜上的排名`;

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
