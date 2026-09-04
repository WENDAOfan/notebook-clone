package com.example.notebook_clone.common;

import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import java.util.stream.Collectors;

/**
 * 全局异常处理器
 * 所有 Controller 抛出的异常都会被这里拦截，返回统一的 JSON 格式
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 拦截 @Valid 校验失败的异常
     * 当用户传的参数不满足 @NotBlank、@Size 等条件时，会进到这里
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<?> handleValidation(MethodArgumentNotValidException e) {
        // 把所有校验失败的字段拼成一个字符串
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(err -> err.getField() + ": " + err.getDefaultMessage())
                .collect(Collectors.joining("; "));

        return Result.fail(message);
    }

    /**
     * 拦截所有 RuntimeException（包括你手动 throw 的那些）
     * 比如你在 Controller 里写 throw new RuntimeException("笔记本不存在！")
     */
    @ExceptionHandler(RuntimeException.class)
    public Result<?> handleRuntime(RuntimeException e) {
        return Result.fail(e.getMessage());
    }
}
