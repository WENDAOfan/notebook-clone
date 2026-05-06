package com.example.notebook_clone;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class NotebookCloneApplication {

	public static void main(String[] args) {
		SpringApplication.run(NotebookCloneApplication.class, args);
	}

}
