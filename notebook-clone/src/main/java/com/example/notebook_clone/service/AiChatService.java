package com.example.notebook_clone.service;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class AiChatService {

    private final ChatClient chatClient;

    public AiChatService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    public String askBasedOnDocument(String documentContent, String question) {
        // 1. 如果文档内容为空，返回什么？
        if (documentContent == null || documentContent.trim().isEmpty()) {
            return "文档内容为空，无法回答问题。";
        }

        // 2. 如果内容超过 8000 字，怎么处理？（和摘要服务保持一致）
        String context = documentContent.length() > 8000
                ? documentContent.substring(0, 8000) + "\n...（内容已截断）"
                : documentContent;

        // 3. 调用 AI：System Prompt 设定角色 + User Prompt 拼接文档+问题
        String answer = chatClient.prompt()// 创建 Prompt 对象
                .system("""
                        你是一位知识库问答助手。请严格遵循以下规则：
                        1.只基于用户提供的【文档内容】回答问题
                        2. 如果文档中没有相关信息，明确回答"根据文档内容，无法找到相关答案"
                        3. 回答要简洁，控制在 300 字以内
                        4. 不要添加文档中没有的信息
                        """)
                .user("""
                        【文档内容】
                        %s

                        【用户问题】
                        %s
                        """.formatted(context, question))// 拼接文档和用户问题
                .call()//调用AI
                .content();// 获取回答

        return answer;
    }
}