package com.example.notebook_clone.controller;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.web.bind.annotation.*;
import com.example.notebook_clone.common.Result;
import com.example.notebook_clone.dto.ChatRequest;

@RestController
@RequestMapping("/test")
public class TestAiController {

    // 1.0.0 GA 版本：注入 Builder 而不是 ChatClient
    private final ChatClient chatClient;

    // 用构造函数接收 Builder，然后 .build()
    public TestAiController(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /**
     * 最基础的 AI 测试接口：问一个固定问题
     */
    @GetMapping("/ai")
    public Result<String> testAi() {
        String answer = chatClient.prompt()
                .user("你好，请用一句话介绍你自己")
                .call()
                .content();

        return Result.success(answer);
    }
    /**
     * Day 19 核心接口：支持自定义问题和 System Prompt
     */
    @PostMapping("/ai")
    public Result<String> chat(@RequestBody ChatRequest request) {
        // 参数校验
        if (request.getQuestion() == null || request.getQuestion().trim().isEmpty()) {
            return Result.fail("问题不能为空");
        }

        // 构建 Prompt
        ChatClient.ChatClientRequestSpec prompt = chatClient.prompt();

        // 如果传了 systemPrompt，就设置 System 角色
        if (request.getSystemPrompt() != null && !request.getSystemPrompt().trim().isEmpty()) {
            prompt.system(request.getSystemPrompt());
        }

        // 设置 User 问题，发起调用
        String answer = prompt
                .user(request.getQuestion())
                .call()
                .content();

        return Result.success(answer);
    }

}
