import { TUSHARE_CONFIG } from '../config.js';
import { resolveStockCodes } from '../utils/stockCodeResolver.js';

export const kplList = {
  name: 'kpl_list',
  description: '获取开盘啦榜单数据，包括涨停、跌停、炸板等榜单数据。可用于分析市场涨停板个股、板块热点、主力资金流向等',
  parameters: {
    type: 'object',
    properties: {
      trade_date: {
        type: 'string',
        description: '交易日期，格式YYYYMMDD'
      },
      ts_code: {
        type: 'string',
        description: '股票代码（可选），如 000001.SZ'
      },
      tag: {
        type: 'string',
        description: '板单类型（可选），可选值：涨停、炸板、跌停、自然涨停、竞价'
      },
      start_date: {
        type: 'string',
        description: '开始日期（可选），格式YYYYMMDD，与trade_date二选一'
      },
      end_date: {
        type: 'string',
        description: '结束日期（可选），格式YYYYMMDD，与start_date配合使用'
      },
      fields: {
        type: 'string',
        description: '输出字段（可选），不指定则返回全部字段。常用字段：ts_code,name,trade_date,tag,theme,status,net_change,limit_order,amount,turnover_rate'
      }
    },
    required: []
  },
  async run(args: {
    trade_date?: string;
    ts_code?: string;
    tag?: string;
    start_date?: string;
    end_date?: string;
    fields?: string;
  }) {
    try {
      if (!TUSHARE_CONFIG.API_TOKEN) {
        throw new Error('请配置TUSHARE_TOKEN环境变量');
      }

      // 验证tag参数
      const validTags = ['涨停', '炸板', '跌停', '自然涨停', '竞价'];
      if (args.tag && !validTags.includes(args.tag)) {
        throw new Error(`无效的tag参数: ${args.tag}。支持的类型: ${validTags.join(', ')}`);
      }

      // 构建请求参数
      const params: any = {
        api_name: 'kpl_list',
        token: TUSHARE_CONFIG.API_TOKEN,
        params: {},
        fields: args.fields || ''
      };

      // 添加可选参数
      if (args.trade_date) {
        params.params.trade_date = args.trade_date;
      }
      if (args.ts_code) {
        params.params.ts_code = args.ts_code;
      }
      if (args.tag) {
        params.params.tag = args.tag;
      }
      if (args.start_date) {
        params.params.start_date = args.start_date;
      }
      if (args.end_date) {
        params.params.end_date = args.end_date;
      }

      // 至少需要提供一个日期或股票代码
      if (!args.trade_date && !args.start_date && !args.ts_code) {
        throw new Error('请至少提供 trade_date、start_date 或 ts_code 中的一个参数');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TUSHARE_CONFIG.TIMEOUT);

      try {
        const resp = await fetch(TUSHARE_CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: controller.signal
        });

        if (!resp.ok) {
          throw new Error(`Tushare API请求失败: ${resp.status}`);
        }

        const data = await resp.json();

        if (data.code !== 0) {
          throw new Error(`Tushare API错误: ${data.msg}`);
        }

        const fields: string[] = data.data?.fields ?? [];
        const items: any[] = data.data?.items ?? [];

        if (items.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `# 开盘啦榜单数据查询\n\n暂无数据\n\n查询参数：\n${JSON.stringify(params.params, null, 2)}`
              }
            ]
          };
        }

        // 字段中文映射
        const fieldNames: Record<string, string> = {
          ts_code: '代码',
          name: '名称',
          trade_date: '交易日期',
          lu_time: '涨停时间',
          ld_time: '跌停时间',
          open_time: '开板时间',
          last_time: '最后涨停时间',
          lu_desc: '涨停原因',
          tag: '标签',
          theme: '板块',
          net_change: '主力净额(元)',
          bid_amount: '竞价成交额(元)',
          status: '状态',
          bid_change: '竞价净额',
          bid_turnover: '竞价换手率(%)',
          lu_bid_vol: '涨停委买额',
          pct_chg: '涨跌幅(%)',
          bid_pct_chg: '竞价涨幅(%)',
          rt_pct_chg: '实时涨幅(%)',
          limit_order: '封单',
          amount: '成交额(元)',
          turnover_rate: '换手率(%)',
          free_float: '实际流通',
          lu_limit_order: '最大封单'
        };

        // 构建表头
        const headers = fields.map(f => fieldNames[f] || f);
        let table = `| ${headers.join(' | ')} |\n`;
        table += `|${headers.map(() => '---------').join('|')}|\n`;

        // 收集股票代码用于解析
        const stockCodes: string[] = [];
        let totalNetChange = 0;
        let totalAmount = 0;
        let limitUpCount = 0;

        // 构建表格行
        for (const row of items) {
          const obj: Record<string, any> = {};
          fields.forEach((f: string, idx: number) => {
            obj[f] = row[idx];
          });

          // 收集股票代码
          if (obj.ts_code) {
            stockCodes.push(String(obj.ts_code));
          }

          // 统计数据
          if (obj.net_change && !isNaN(Number(obj.net_change))) {
            totalNetChange += Number(obj.net_change);
          }
          if (obj.amount && !isNaN(Number(obj.amount))) {
            totalAmount += Number(obj.amount);
          }
          if (obj.tag === '涨停') {
            limitUpCount++;
          }

          const line = fields.map(f => {
            const v = obj[f];
            if (v === null || v === undefined || v === '') return '-';
            // 格式化数值字段
            if (['net_change', 'bid_amount', 'bid_change', 'lu_bid_vol', 'limit_order', 'amount', 'lu_limit_order'].includes(f)) {
              const num = Number(v);
              return isNaN(num) ? '-' : num.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
            }
            if (['bid_turnover', 'pct_chg', 'bid_pct_chg', 'rt_pct_chg', 'turnover_rate'].includes(f)) {
              const num = Number(v);
              return isNaN(num) ? '-' : num.toFixed(2) + '%';
            }
            return String(v);
          });
          table += `| ${line.join(' | ')} |\n`;
        }

        // 构建标题和摘要
        const tagText = args.tag ? ` - ${args.tag}` : '';
        const dateText = args.trade_date || `${args.start_date} ~ ${args.end_date || '至今'}`;
        const title = `# 开盘啦榜单数据 ${dateText}${tagText}`;

        const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
        const summary = `## 数据统计\n- **数据条数**: ${items.length}条\n- **涨停数量**: ${limitUpCount}只\n- **主力净流入**: ${fmt(totalNetChange)}元\n- **总成交额**: ${fmt(totalAmount)}元`;

        // 解析股票代码
        const stockExplanation = stockCodes.length > 0 ? await resolveStockCodes(stockCodes) : '';

        return {
          content: [
            {
              type: 'text',
              text: `${title}\n\n${summary}\n\n---\n\n${table}${stockExplanation}`
            }
          ]
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ 查询失败: ${error instanceof Error ? error.message : String(error)}\n\n### 支持的tag类型:\n- **涨停**: 当日涨停股票\n- **炸板**: 涨停后打开的股票\n- **跌停**: 当日跌停股票\n- **自然涨停**: 自然涨停的股票\n- **竞价**: 竞价异动股票`
          }
        ],
        isError: true
      };
    }
  }
};
