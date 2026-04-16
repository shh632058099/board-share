export function createNotifier(config, feishuClient) {
  return {
    async sendReturnRequest({ reservation, board, requester }) {
      const text = [
        `单板 ${board.boardNo} 已超时，请尽快归还。`,
        `当前使用人：${reservation.userName}`,
        `请求人：${requester.name}`,
        `计划归还时间：${reservation.plannedEndAt}`,
      ].join('\n');

      if (!feishuClient?.enabled) {
        console.info(`[return-request:skipped]\n${text}`);
        return 'skipped';
      }

      const results = [];
      try {
        await feishuClient.sendTextToUser(reservation.userId, text);
        results.push('private_sent');
      } catch (error) {
        console.error('Failed to send Feishu private return request:', error);
        results.push('private_failed');
      }

      if (config.feishu.chatId) {
        try {
          await feishuClient.sendTextToChat(config.feishu.chatId, text);
          results.push('group_sent');
        } catch (error) {
          console.error('Failed to send Feishu group return request:', error);
          results.push('group_failed');
        }
      } else {
        results.push('group_skipped');
      }

      if (results.every((result) => result.endsWith('_sent') || result.endsWith('_skipped'))) {
        return results.includes('group_skipped') ? 'partial' : 'sent';
      }
      return 'failed';
    },
  };
}
