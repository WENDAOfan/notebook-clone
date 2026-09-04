package com.example.notebook_clone.dto;

import lombok.Data;

@Data
public class AskRequest {
    /**
     * 用户的问题（必填）
     */
    private String question;

    /**
     * 是否基于文档内容回答（可选，默认 true）
     */
    private Boolean useDocumentContext = true;
}
