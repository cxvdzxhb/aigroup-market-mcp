import { TUSHARE_CONFIG } from '../config.js';

export const limitCptList = {
  name: 'limit_cpt_list',
  description: '最强板块统计(limit_cpt_list)。必填：交易日期。返回当日最强板块统计，包含涨停家数、封板率、连板数等数据。',
  parameters: {
    type: 'object',
    properties: {
      trade_date: {
        type: 'string',
        description: '交易日期，格式YYYYMMDD'
      }
    },
    required: ['trade_date']
  },
  async run(args: { trade_date: string }) {
    try {
      if (!args.trade_date || args.trade_date.trim().length !== 8) {
        throw new Error('trade_date 必须为YYYYMMDD');
      }

      if (!TUSHARE_CONFIG.API_TOKEN) {
        throw new Error('请配置TUSHARE_TOKEN环境变量');
      }

      const params: any = {
        api_name: 'limit_cpt_list',
        token: TUSHARE_CONFIG.API_TOKEN,
        params: {
          trade_date: args.trade_date
        }
      };

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
              { type: 'text', text: `# 最强板块统计 ${args.trade_date}\n\n暂无数据` }
            ]
          };
        }

        // 字段说明
        const fieldMapping: Record<string, string> = {
          'ts_code': '板块代码',
          'name': '板块名称',
          'trade_date': '交易日期',
          'days': '上榜天数',
          'up_stat': '连板高度',
          'cons_nums': '连板家数',
          'up_nums': '涨停家数',
          'pct_chg': '涨跌幅%',
          'rank': '板块热点排名',
        };

        // 构建表头
        const desiredFields = ['ts_code', 'name', 'trade_date', 'days',
                               'up_stat', 'cons_nums', 'up_nums', 'pct_chg', 'rank'];
        const headers = desiredFields.filter(f => fields.includes(f));

        let table = `| ${headers.map(h => fieldMapping[h] || h).join(' | ')} |\n`;
        table += `|${headers.map(() => '--------').join('|')}|\n`;

        let totalLimitAmount = 0;
        let totalLimitNum = 0;
        let totalUpStat = 0;

        for (const row of items) {
          const obj: Record<string, any> = {};
          fields.forEach((f: string, idx: number) => obj[f] = row[idx]);

          const line = headers.map(h => {
            const v = obj[h];
            if (v === null || v === undefined || v === '') return 'N/A';

            // 数值字段格式化
            if (['ratio'].includes(h)) {
              return Number(v).toFixed(2);
            }
            // 金额字段格式化
            if (['limit_amount', 'avg_limit_amount', 'max_limit_amount'].includes(h)) {
              return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
            }
            // 数量字段
            if (['limit_num', 'up_stat', 'board_cnt'].includes(h)) {
              return String(v);
            }
            return String(v);
          });
          table += `| ${line.join(' | ')} |\n`;

          // 统计合计
          const limitAmountVal = Number(obj.limit_amount);
          const limitNumVal = Number(obj.limit_num);
          const upStatVal = Number(obj.up_stat);
          if (!isNaN(limitAmountVal)) totalLimitAmount += limitAmountVal;
          if (!isNaN(limitNumVal)) totalLimitNum += limitNumVal;
          if (!isNaN(upStatVal)) totalUpStat += upStatVal;
        }

        const title = `# 最强板块统计 ${args.trade_date}`;
        const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
        const summary = `\n\n## 📊 当日统计\n- 统计板块: ${items.length} 个\n- 涨停家数(含ST): ${totalLimitNum} 只\n- 涨停家数(不含ST): ${totalUpStat} 只\n- 封单金额合计: ${fmt(totalLimitAmount)} 万元\n- 平均封板率: ${items.length > 0 ? fmt(totalLimitAmount / items.length) : 'N/A'}`;

        // 添加字段说明
        const fieldNotes = `\n\n## 📝 字段说明\n- **涨停家数**: 该板块当日涨停股票数量\n- **封板率**: 涨停封住的数量/尝试涨停的总数\n- **连板数**: 连续涨停的天数统计\n- **自然板**: 不含ST股票的涨停板数\n- **封单金额**: 涨停价上的挂单金额(万元)`;

        return {
          content: [
            { type: 'text', text: `${title}\n\n${table}${summary}${fieldNotes}` }
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
