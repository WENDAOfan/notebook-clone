package com.example.notebook_clone;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.retry.annotation.EnableRetry;//day26

@SpringBootApplication
@EnableAsync
@EnableRetry
public class NotebookCloneApplication {

	public static void main(String[] args) {
		SpringApplication.run(NotebookCloneApplication.class, args);
	}

}
