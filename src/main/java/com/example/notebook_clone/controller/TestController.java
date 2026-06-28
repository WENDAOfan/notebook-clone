package com.example.notebook_clone.controller;

import com.example.notebook_clone.common.Result;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 测试接口：验证 JWT 认证是否生效
 */
@RestController//REST 控制器，是 @Controller + @ResponseBody 的合体。效果是：方法返回的对象会自动转成 JSON 返回给前端
@RequestMapping("/api/test")//给这个类中所有方法加上路径前缀 /api/test
public class TestController {

    /**
     * 获取当前登录用户信息
     * 需要携带有效 Token 才能访问
     */
    @GetMapping("/current-user")
    public Result<String> getCurrentUser() {
        // 从 SecurityContext 获取当前登录用户名
        // JwtAuthenticationFilter 已经把用户信息存入这里了
        String username = SecurityContextHolder.getContext()
                .getAuthentication().getName();
        
        return Result.success("当前登录用户：" + username);
    }

    /**
     * 简单的受保护接口
     */
    @GetMapping("/protected")
    public Result<String> protectedEndpoint() {
        return Result.success("这是一个受保护的接口，你已成功访问！");
    }
}