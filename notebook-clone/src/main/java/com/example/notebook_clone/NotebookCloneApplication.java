package com.example.notebook_clone;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;  // Day 30：定时清理对话历史
import org.springframework.retry.annotation.EnableRetry;//day26

@SpringBootApplication
@EnableAsync
@EnableScheduling  // Day 30：开启定时任务，支持 ChatHistoryService 清理过期历史
@EnableRetry
public class NotebookCloneApplication {

	public static void main(String[] args) {
		SpringApplication.run(NotebookCloneApplication.class, args);
	}

}
