import { TUSHARE_CONFIG } from '../config.js';

export const hmList = {
  name: 'hm_list',
  description: '游资名录(hm_list)。可选：营业部名称/代码。返回热门游资营业部名录，包含营业部代码、名称、类型等信息。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: '可选，营业部名称，支持模糊搜索'
      },
      department: {
        type: 'string',
        description: '可选，营业部代码'
      }
    }
  },
  async run(args: { name?: string; department?: string }) {
    try {
      if (!TUSHARE_CONFIG.API_TOKEN) {
        throw new Error('请配置TUSHARE_TOKEN环境变量');
      }

      const params: any = {
        api_name: 'hm_list',
        token: TUSHARE_CONFIG.API_TOKEN,
        params: {}
      };
      if (args.name) params.params.name = args.name;
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
              { type: 'text', text: `# 游资名录查询${args.name ? ` - ${args.name}` : ''}${args.department ? ` - ${args.department}` : ''}\n\n暂无数据` }
            ]
          };
        }

        // 字段说明
        const fieldMapping: Record<string, string> = {
          'department': '营业部代码',
          'name': '营业部名称',
          'status': '状态',
          'market': '市场'
        };

        // 构建表头
        const desiredFields = ['department', 'name', 'status', 'market'];
        const headers = desiredFields.filter(f => fields.includes(f));

        let table = `| ${headers.map(h => fieldMapping[h] || h).join(' | ')} |\n`;
        table += `|${headers.map(() => '--------').join('|')}|\n`;

        for (const row of items) {
          const obj: Record<string, any> = {};
          fields.forEach((f: string, idx: number) => obj[f] = row[idx]);

          const line = headers.map(h => {
            const v = obj[h];
            return (v === null || v === undefined || v === '') ? 'N/A' : String(v);
          });
          table += `| ${line.join(' | ')} |\n`;
        }

        const title = `# 游资名录查询${args.name ? ` - ${args.name}` : ''}${args.department ? ` - ${args.department}` : ''}`;
        const summary = `\n\n## 📊 查询结果\n- 游资营业部数量: ${items.length} 家`;

        // 添加字段说明
        const fieldNotes = `\n\n## 📝 字段说明\n- **营业部代码**: 营业部的唯一标识代码\n- **营业部名称**: 营业部的完整名称\n- **状态**: 营业部的当前状态\n- **市场**: 所属市场（如沪深市场）`;

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
