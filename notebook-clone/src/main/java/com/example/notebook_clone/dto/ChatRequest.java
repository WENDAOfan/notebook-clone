package com.example.notebook_clone.dto;

import lombok.Data;

@Data
public class ChatRequest {
    /**
     * 用户的问题（必填）
     */
    private String question;

    /**
     * 系统提示词（可选，不传则使用默认）
     */
    private String systemPrompt;
}
