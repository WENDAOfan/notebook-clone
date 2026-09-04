package com.example.notebook_clone;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

// @RestController 告诉 Spring：这个类是用来接收外部网络请求的
@RestController
public class HelloController {

    // @GetMapping 规定了访问路径，当浏览器访问 /hello 时，就会执行下面的方法
    @GetMapping("/hello")
    public String sayHello() {
        return "你好，NotebookLM Clone！我的第一个 Spring Boot AI 后端跑起来了！";
    }
}